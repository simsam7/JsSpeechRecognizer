/**
 * JavaScript based speech recognizer.
 * 
 * Copyright 2016, Dominic Winkelman
 * Free to use under the Apache 2.0 License
 * 
 * https://github.com/dreamdom/JsSpeechRecognizer
 * 
 * Requires the WebRTC adapter.js file.
 */

function JsSpeechRecognizer() {

    // Variables for recording data
    this.recordingBufferArray = [];
    this.currentRecordingBuffer = [];
    this.wordBuffer = [];
    this.modelBuffer = [];
    this.groupedValues = [];

    // The speech recognition model
    this.model = {};
    
    // The average model contains one average entry for each key
    this.averageModel = {};

    // State variables. Initialize to not recording and not doing recognition
    this.isRecording = false;
    this.doRecognition = false;

    // Get an audio context
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Create an analyser
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.minDecibels = -80;
    this.analyser.maxDecibels = -10;
    this.analyser.smoothingTimeConstant = 0;
    this.analyser.fftSize = 1024;

    // Parameters for the model calculation
    this.numGroups = 25;
    this.groupSize = 10;
    this.minPower = 0.01;

    // Create the scriptNode
    this.scriptNode = this.audioCtx.createScriptProcessor(this.analyser.fftSize, 1, 1);

    // Function for script node to process
    var _this = this;
    this.scriptNode.onaudioprocess = function(audioProcessingEvent) {

        var i = 0;

        // If we aren't recording, don't do anything
        if (!_this.isRecording) {
            return;
        }

        // get the fft data
        var dataArray = new Uint8Array(_this.analyser.fftSize);
        _this.analyser.getByteFrequencyData(dataArray);

        // Find the max in the fft array
        var max = Math.max.apply(Math, dataArray);

        // If the max is zero ignore it.
        if (max === 0) {
            return;
        }

        // Get the audio data. For simplicity just take one channel
        var inputBuffer = audioProcessingEvent.inputBuffer;
        var leftChannel = inputBuffer.getChannelData(0);

        // Calculate the power
        var curFrame = new Float32Array(leftChannel);
        var power = 0;
        for (i = 0; i < curFrame.length; i++) {
            power += curFrame[i] * curFrame[i];
        }

        // Check for the proper power level
        if (power < _this.minPower) {
            return;
        }

        // Save the data for playback.
        Array.prototype.push.apply(_this.currentRecordingBuffer, curFrame);

        // Normalize and Group the frequencies
        var groups = [];

        for (i = 0; i < _this.numGroups; i++) {
            var peakGroupValue = 0;
            for (var j = 0; j < _this.groupSize; j++) {
                var curPos = (_this.groupSize * i) + j;

                // normalize the value
                var tempCalc = Math.floor((dataArray[curPos] / max) * 100);

                // Keep the peak normalized value for this group
                if (tempCalc > peakGroupValue) {
                    peakGroupValue = tempCalc;
                }

            }
            groups.push(peakGroupValue);
        }
        _this.groupedValues.push(groups);
    };

}

JsSpeechRecognizer.prototype.openMic = function() {
    // Request access to the microphone
    var constraints = {
        "audio": true
    };

    navigator.getUserMedia(constraints, successCallback, errorCallback);

    var _this = this;
    // Acess to the microphone was granted
    function successCallback(stream) {
        _this.stream = stream;
        _this.source = _this.audioCtx.createMediaStreamSource(stream);

        _this.source.connect(_this.analyser);
        _this.analyser.connect(_this.scriptNode);

        // This is needed for chrome
        _this.scriptNode.connect(_this.audioCtx.destination);
    }

    function errorCallback(error) {
        console.error('navigator.getUserMedia error: ', error);
    }
};

JsSpeechRecognizer.prototype.startTrainingRecording = function(curWord) {

    this.doRecognition = false;
    this.isRecording = true;

    // Create a new current recording buffer
    this.currentRecordingBuffer = [];

    // Create a new groupedValues buffer
    this.groupedValues = [];
    this.wordBuffer.push(curWord);
};

JsSpeechRecognizer.prototype.startRecognitionRecording = function() {

    this.doRecognition = true;
    this.isRecording = true;

    // Create a new current recording buffer
    this.currentRecordingBuffer = [];

    // Create a new groupedValues buffer
    this.groupedValues = [];
};

JsSpeechRecognizer.prototype.stopRecording = function() {

    this.isRecording = false;
    this.groupedValues = [].concat.apply([], this.groupedValues);

    // If we are doing recognition we don't want to save to the model
    if (this.doRecognition) {
        return;
    }

    // This is training
    this.recordingBufferArray.push(this.currentRecordingBuffer.slice(0));
    // Save the recognition model
    this.modelBuffer.push(this.groupedValues.slice(0));

    return this.recordingBufferArray.length;
};

/**
 * Function will play back the recorded audio for a specific index that is part of the training data.
 */
JsSpeechRecognizer.prototype.playTrainingBuffer = function(index) {

    // Mono
    var channels = 1;
    var playBuffer = this.recordingBufferArray[index];
    var frameCount = playBuffer.length;
    var myArrayBuffer = this.audioCtx.createBuffer(channels, frameCount, this.audioCtx.sampleRate);

    for (var channel = 0; channel < channels; channel++) {
        var nowBuffering = myArrayBuffer.getChannelData(channel);
        for (var i = 0; i < frameCount; i++) {
            nowBuffering[i] = playBuffer[i];
        }
    }

    this.playMonoAudio(myArrayBuffer);

};

JsSpeechRecognizer.prototype.deleteTrainingBuffer = function(input) {
    this.modelBuffer[input] = null;
};

JsSpeechRecognizer.prototype.playMonoAudio = function(playBuffer) {
    var playSource = this.audioCtx.createBufferSource();
    playSource.buffer = playBuffer;
    playSource.connect(this.audioCtx.destination);
    playSource.start();
};

/**
 * Method to generate the new speech recognition model from the  training data.
 */
JsSpeechRecognizer.prototype.generateModel = function() {

    // Local vars
    var i = 0;
    var key = "";

    // Reset the model
    this.model = {};

    for (i = 0; i < this.wordBuffer.length; i++) {
        key = this.wordBuffer[i];
        this.model[key] = [];
    }

    for (i = 0; i < this.modelBuffer.length; i++) {
        if (this.modelBuffer[i] !== null) {
            key = this.wordBuffer[i];
            this.model[key].push(this.modelBuffer[i]);
        }
    }
    
    // Average Model
    // Holds one entry for each key. That entry is the average of all the entries in the model
    this.averageModel = {};
    for (key in this.model) {
        var average = [];
        for (i = 0; i < this.model[key].length; i++) {
            for(var j = 0; j < this.model[key][i].length; j++) {
                average[j] = (average[j] || 0) + (this.model[key][i][j] / this.model[key].length);
            }
        }
        
        this.averageModel[key] = [];
        this.averageModel[key].push(average);
    }
    
};


JsSpeechRecognizer.prototype.getTopRecognitionHypotheses = function(numResults) {
    // use the model or the averageModel to find the closest match
    return this.findClosestMatch(this.groupedValues, numResults, this.averageModel);
};


// Calculation functions

JsSpeechRecognizer.prototype.findClosestMatch = function(input, numResults, speechModel) {

    var i = 0;
    var key = "";
    var allResults = [];

    // Loop through all the keys in the model
    for (key in speechModel) {
        // Loop through all entries for that key
        for (i = 0; i < speechModel[key].length; i++) {

            var curDistance = this.findDistance(input, speechModel[key][i]);
            var curConfidence = this.calcConfidence(curDistance, speechModel[key][i]);

            var newResult = {};
            newResult.match = key;
            newResult.confidence = curConfidence;
            allResults.push(newResult);
        }

    }

    allResults.sort(function(a, b) { return b.confidence - a.confidence; });

    return allResults.slice(0, numResults);
};

JsSpeechRecognizer.prototype.findDistance = function(input, check) {
    var i = 0;
    var distance = 0;

    for (i = 0; i < Math.max(input.length, check.length); i++) {
        var checkVal = check[i] || 0;
        var inputVal = input[i] || 0;
        distance += Math.abs(checkVal - inputVal);
    }

    return distance;
};

JsSpeechRecognizer.prototype.calcConfidence = function(distance, matchArray) {
    var sum = 0;
    var i = 0;

    for (i = 0; i < matchArray.length; i++) {
        sum += matchArray[i];
    }

    return (1 - (distance / sum));
};

