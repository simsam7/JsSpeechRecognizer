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

    // Constants
    this.RecordingEnum = { "NOT_RECORDING": 0, "TRAINING": 1, "RECOGNITION": 2, "KEYWORD_SPOTTING": 3 };
    Object.freeze(this.RecordingEnum);
    this.RecognitionModel = { "TRAINED": 0, "AVERAGE": 1, "COMPOSITE": 2 };
    Object.freeze(this.RecognitionModel);

    // Variables for recording data
    this.recordingBufferArray = [];
    this.currentRecordingBuffer = [];
    this.wordBuffer = [];
    this.modelBuffer = [];
    this.groupedValues = [];

    // Keyword spotting variables for recording data
    this.keywordSpottingGroupBuffer = [];
    this.keywordSpottingRecordingBuffer = [];

    // The speech recognition model
    this.model = {};

    // The average model contains one average entry for each key
    this.averageModel = {};

    // State variable. Initialize to not recording
    this.recordingState = this.RecordingEnum.NOT_RECORDING;
    // Default to using the composite recognition model
    this.useRecognitionModel = this.RecognitionModel.COMPOSITE;

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

    // Keyword spotting parameters
    this.keywordSpottingMinConfidence = 0.50;
    this.keywordSpottingBufferCount = 80;
    this.keywordSpottingLastVoiceActivity = 0;
    this.keywordSpottingMaxVoiceActivityGap = 300;
    this.keywordSpottedCallback = null;

    // Create the scriptNode
    this.scriptNode = this.audioCtx.createScriptProcessor(this.analyser.fftSize, 1, 1);

    // Function for script node to process
    var _this = this;
    this.scriptNode.onaudioprocess = function(audioProcessingEvent) {

        var i = 0;

        // If we aren't recording, don't do anything
        if (_this.recordingState === _this.RecordingEnum.NOT_RECORDING) {
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

                // now normalizing after the recording has finished
                var tempCalc = dataArray[curPos];

                // Keep the peak normalized value for this group
                if (tempCalc > peakGroupValue) {
                    peakGroupValue = tempCalc;
                }

            }
            groups.push(peakGroupValue);
        }

        // Depending on the state, handle the data differently
        if (_this.recordingState === _this.RecordingEnum.KEYWORD_SPOTTING) {

            // Check if we should reset the buffers
            var now = new Date().getTime();
            if (now - _this.keywordSpottingLastVoiceActivity > _this.keywordSpottingMaxVoiceActivityGap) {
                _this.keywordSpottingGroupBuffer = [];
                _this.keywordSpottingRecordingBuffer = [];
            }
            _this.keywordSpottingLastVoiceActivity = now;

            _this.keywordSpottingProcessFrame(groups, curFrame);
        } else {
            _this.groupedValues.push(groups);
        }

    };  // End of onaudioprocess

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

/**
 * Returns false if the recognizer is not recording. True otherwise.
 */
JsSpeechRecognizer.prototype.isRecording = function() {
    if (this.recordingState === this.RecordingEnum.NOT_RECORDING) {
        return false;
    }

    return true;
};

JsSpeechRecognizer.prototype.startTrainingRecording = function(curWord) {

    this.recordingState = this.RecordingEnum.TRAINING;

    // Create a new current recording buffer
    this.currentRecordingBuffer = [];

    // Create a new groupedValues buffer
    this.groupedValues = [];
    this.wordBuffer.push(curWord);
};

JsSpeechRecognizer.prototype.startRecognitionRecording = function() {

    this.recordingState = this.RecordingEnum.RECOGNITION;

    // Create a new current recording buffer
    this.currentRecordingBuffer = [];

    // Create a new groupedValues buffer
    this.groupedValues = [];
};

JsSpeechRecognizer.prototype.startKeywordSpottingRecording = function() {
    this.recordingState = this.RecordingEnum.KEYWORD_SPOTTING;

    // Create a new current recording buffer
    this.currentRecordingBuffer = [];

    // Create a new groupedValues buffer
    this.groupedValues = [];
};

JsSpeechRecognizer.prototype.stopRecording = function() {

    this.groupedValues = [].concat.apply([], this.groupedValues);

    // normalize!
    this.normalizeInput(this.groupedValues);

    // If we are training we want to save to the recongition model
    if (this.recordingState === this.RecordingEnum.TRAINING) {
        this.recordingBufferArray.push(this.currentRecordingBuffer.slice(0));
        this.modelBuffer.push(this.groupedValues.slice(0));
    }

    this.recordingState = this.RecordingEnum.NOT_RECORDING;

    return this.recordingBufferArray.length;
};

/**
 * Function will play back the recorded audio for a specific index that is part of the training data.
 */
JsSpeechRecognizer.prototype.playTrainingBuffer = function(index) {
    this.playMonoAudio(this.recordingBufferArray[index]);
};

JsSpeechRecognizer.prototype.deleteTrainingBuffer = function(input) {
    this.modelBuffer[input] = null;
};

JsSpeechRecognizer.prototype.playMonoAudio = function(playBuffer) {

    // Mono
    var channels = 1;
    var frameCount = playBuffer.length;
    var myArrayBuffer = this.audioCtx.createBuffer(channels, frameCount, this.audioCtx.sampleRate);

    for (var channel = 0; channel < channels; channel++) {
        var nowBuffering = myArrayBuffer.getChannelData(channel);
        for (var i = 0; i < frameCount; i++) {
            nowBuffering[i] = playBuffer[i];
        }
    }

    var playSource = this.audioCtx.createBufferSource();
    playSource.buffer = myArrayBuffer;
    playSource.connect(this.audioCtx.destination);
    playSource.start();
};

/**
 * Method to generate the new speech recognition model from the training data.
 */
JsSpeechRecognizer.prototype.generateModel = function() {

    // Local vars
    var i = 0;
    var j = 0;
    var k = 0;
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
            for (j = 0; j < this.model[key][i].length; j++) {
                average[j] = (average[j] || 0) + (this.model[key][i][j] / this.model[key].length);
            }
        }

        this.averageModel[key] = [];
        this.averageModel[key].push(average);
    }

    // Interpolation - Take the average of each pair of entries for a key and 
    // add it to the average model
    for (key in this.model) {

        var averageInterpolation = [];
        for (k = 0; k < this.model[key].length; k++) {
            for (i = k + 1; i < this.model[key].length; i++) {

                averageInterpolation = [];
                for (j = 0; j < Math.max(this.model[key][k].length, this.model[key][i].length); j++) {
                    averageInterpolation[j] = (this.model[key][k][j] + this.model[key][i][j]) / 2;
                }

                this.averageModel[key].push(averageInterpolation);
            }
        }
    }

};


JsSpeechRecognizer.prototype.getTopRecognitionHypotheses = function(numResults) {

    if (this.useRecognitionModel === this.RecognitionModel.AVERAGE) {
        return this.findClosestMatch(this.groupedValues, numResults, this.averageModel, this.findDistance);
    } else if (this.useRecognitionModel === this.RecognitionModel.TRAINED) {
        return this.findClosestMatch(this.groupedValues, numResults, this.model, this.findDistance);
    } else {
        // For the composite model, combine the trained and average results and sort them
        var results = this.findClosestMatch(this.groupedValues, -1, this.model, this.findDistance);
        var resultsAverage = this.findClosestMatch(this.groupedValues, -1, this.averageModel, this.findDistance);

        var allResults = results.concat(resultsAverage);
        allResults.sort(function(a, b) { return b.confidence - a.confidence; });

        return allResults.slice(0, numResults);
    }
};

/**
 * Function called to process a new frame of data while in recording state KEYWORD_SPOTTING.
 *  groups - the group data for the frame
 *  curFrame - the raw audio data for the frame
 */
JsSpeechRecognizer.prototype.keywordSpottingProcessFrame = function(groups, curFrame) {

    var computedLength;
    var key;
    var allResults = [];
    var recordingLength;
    var workingGroupBuffer = [];

    // Append to the keywordspotting buffer
    this.keywordSpottingGroupBuffer.push(groups);
    this.keywordSpottingGroupBuffer = [].concat.apply([], this.keywordSpottingGroupBuffer);

    // Trim the buffer if necessary
    computedLength = (this.keywordSpottingBufferCount * this.numGroups);
    if (this.keywordSpottingGroupBuffer.length > computedLength) {
        this.keywordSpottingGroupBuffer = this.keywordSpottingGroupBuffer.slice(this.keywordSpottingGroupBuffer.length - computedLength, this.keywordSpottingGroupBuffer.length);
    }

    // Save the audio data
    Array.prototype.push.apply(this.keywordSpottingRecordingBuffer, curFrame);

    // Trim the buffer if necessary
    computedLength = (this.keywordSpottingBufferCount * this.analyser.fftSize);
    if (this.keywordSpottingRecordingBuffer.length > computedLength) {
        this.keywordSpottingRecordingBuffer = this.keywordSpottingRecordingBuffer.slice(this.keywordSpottingRecordingBuffer.length - computedLength, this.keywordSpottingRecordingBuffer.length);
    }

    // Copy buffer, and normalize it, and use it to find the closest match
    workingGroupBuffer = this.keywordSpottingGroupBuffer.slice(0);
    this.normalizeInput(workingGroupBuffer);

    if (this.useRecognitionModel === this.RecognitionModel.AVERAGE) {
        allResults = this.findClosestMatch(workingGroupBuffer, -1, this.averageModel, this.findDistanceForKeywordSpotting);
    } else if (this.useRecognitionModel === this.RecognitionModel.TRAINED) {
        allResults = this.findClosestMatch(workingGroupBuffer, -1, this.model, this.findDistanceForKeywordSpotting);
    } else {
        // Using the composite model. Combine the trained and the average
        var results = this.findClosestMatch(workingGroupBuffer, -1, this.model, this.findDistanceForKeywordSpotting);
        var resultsAverage = this.findClosestMatch(workingGroupBuffer, -1, this.averageModel, this.findDistanceForKeywordSpotting);

        allResults = results.concat(resultsAverage);
        allResults.sort(function(a, b) { return b.confidence - a.confidence; });
    }

    // See if a keyword was spotted
    if (allResults[0] !== undefined && allResults[0].confidence > this.keywordSpottingMinConfidence) {

        // Save the audio
        recordingLength = (allResults[0].frameCount / this.numGroups) * this.analyser.fftSize;

        if (recordingLength > this.keywordSpottingRecordingBuffer.length) {
            recordingLength = this.keywordSpottingRecordingBuffer.length;
        }

        allResults[0].audioBuffer = this.keywordSpottingRecordingBuffer.slice(this.keywordSpottingRecordingBuffer.length - recordingLength, this.keywordSpottingRecordingBuffer.length);

        // Reset the buffers
        this.keywordSpottingGroupBuffer = [];
        this.keywordSpottingRecordingBuffer = [];

        if (this.keywordSpottedCallback !== undefined && this.keywordSpottedCallback !== null) {
            this.keywordSpottedCallback(allResults[0]);
        }

    }

};


// Calculation functions

JsSpeechRecognizer.prototype.normalizeInput = function(input) {
    // Find the max in the fft array
    var max = Math.max.apply(Math, input);

    for (var i = 0; i < input.length; i++) {
        input[i] = Math.floor((input[i] / max) * 100);
    }
};

JsSpeechRecognizer.prototype.findClosestMatch = function(input, numResults, speechModel, findDistanceFunction) {

    var i = 0;
    var key = "";
    var allResults = [];

    // If not findDistance function is defined, used the default
    if (findDistanceFunction === undefined) {
        findDistanceFunction = this.findDistanceFunction;
    }

    // Loop through all the keys in the model
    for (key in speechModel) {
        // Loop through all entries for that key
        for (i = 0; i < speechModel[key].length; i++) {

            var curDistance = findDistanceFunction(input, speechModel[key][i]);
            var curConfidence = this.calcConfidence(curDistance, speechModel[key][i]);

            var newResult = {};
            newResult.match = key;
            newResult.confidence = curConfidence;
            newResult.frameCount = speechModel[key][i].length;
            allResults.push(newResult);
        }

    }

    allResults.sort(function(a, b) { return b.confidence - a.confidence; });

    if (numResults === -1) {
        return allResults;
    }

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

JsSpeechRecognizer.prototype.findDistanceForKeywordSpotting = function(input, check) {
    var i = 0;
    var distance = 0;

    // For keyword spotting we check from the end of the check array, and only the check array length
    for (i = 0; i < check.length; i++) {
        var checkVal = check[check.length - i] || 0;
        var inputVal = input[input.length - i] || 0;
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

