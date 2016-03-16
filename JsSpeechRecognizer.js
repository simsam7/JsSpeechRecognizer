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
    this.deleteMap = {};
    this.groupedValues = [];

    // The speech recognition model
    var model = {};

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

        // Loop through the array and find the max
        var max = -1;
        for (i = 0; i < dataArray.length; i++) {
            if (dataArray[i] > max) {
                max = dataArray[i];
            }
        }

        // If the max is zero ignore it.
        if (max === 0) {
            return;
        }

        // Save the data for playback. For simplicity just take one channel
        var inputBuffer = audioProcessingEvent.inputBuffer;
        var leftChannel = inputBuffer.getChannelData(0);
        Array.prototype.push.apply(_this.currentRecordingBuffer, new Float32Array(leftChannel));

        // Normalize and Group the frequencies
        var numGroups = 25;
        var groupSize = 10;
        var groups = [];
        
        for (i = 0; i < numGroups; i++) {
            var peakGroupValue = 0;
            for (var j = 0; j < groupSize; j++) {
                var curPos = (10 * i) + j;

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

    var source2 = this.audioCtx.createBufferSource();
    source2.buffer = myArrayBuffer;
    source2.connect(this.audioCtx.destination);
    source2.start();

};

JsSpeechRecognizer.prototype.deleteTrainingBuffer = function(input) {
    this.deleteMap[input] = true;
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
        if (!this.deleteMap[i]) {
            key = this.wordBuffer[i];
            this.model[key].push(this.modelBuffer[i]);
        }
    }
};

JsSpeechRecognizer.prototype.getTopRecognitionHypothesis = function() {
    return this.findClosestMatch(this.groupedValues);
};


// Calculation functions

JsSpeechRecognizer.prototype.findClosestMatch = function(input) {

    var i = 0;
    var key = "";

    var confidences = {};

    // Loop through all the keys in the model
    for (key in this.model) {
        confidences[key] = [];
        // Loop through all entries for that key
        for (i = 0; i < this.model[key].length; i++) {

            var curDistance = this.findDistance(input, this.model[key][i]);
            var curConfidence = this.calcConfidence(curDistance, this.model[key][i]);

            confidences[key].push(curConfidence);
        }

    }

    var max = -1;
    var maxKey = "";
    var maxKeyIndex = -1;
    for (key in confidences) {

        for (i = 0; i < confidences[key].length; i++) {
            if (max == -1 || confidences[key][i] > max) {
                max = confidences[key][i];
                maxKey = key;
                maxKeyIndex = i;
            }
        }
    }

    var result = {};
    result[maxKey] = max;

    return result;
};

JsSpeechRecognizer.prototype.findDistance = function(input, check) {
    var i = 0;
    var distance = 0;

    if (check.length < input.length) {
        for (i = 0; i < check.length; i++) {
            distance += Math.abs(check[i] - input[i]);
        }
        for (i = check.length; i < input.length; i++) {
            distance += input[i];
        }
    } else {
        for (i = 0; i < input.length; i++) {
            distance += Math.abs(check[i] - input[i]);
        }
        for (i = input.length; i < check.length; i++) {
            distance += check[i];
        }
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

