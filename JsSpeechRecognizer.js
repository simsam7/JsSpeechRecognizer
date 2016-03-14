/**
 * JavaScript based speech recognizer.
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

    // TODO: rename this
    this.dominateBins = [];

    // The speech recognition model
    var model = {};

    // We are not recording yet
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

        // Looping var
        var i = 0;

        // If we aren't recording, don't do anything
        if (!_this.isRecording) {
            return;
        }

        // get the fft data
        var dataArray = new Uint8Array(_this.analyser.fftSize);
        _this.analyser.getByteFrequencyData(dataArray);

        // Loop through the array and print out the max
        var max = -1;
        var bin = -1;
        for (i = 0; i < dataArray.length; i++) {
            if (dataArray[i] > max) {
                max = dataArray[i];
                bin = i;
            }
        }

        // If the max is zero ignore it.
        if (max === 0) {
            return;
        }

        // Save the data for playback
        var inputBuffer = audioProcessingEvent.inputBuffer;
        var leftChannel = inputBuffer.getChannelData(0);
        Array.prototype.push.apply(_this.currentRecordingBuffer, new Float32Array(leftChannel));

        // TODO: Rename addIt
        var groups = [];
        for (i = 0; i < 25; i++) {
            var addIt = 0;
            for (var j = 0; j < 10; j++) {
                var curPos = (10 * i) + j;

                // normalize the value
                var tempCalc = Math.floor((dataArray[curPos] / max) * 100);

                // Keep the peak normalized value for this group
                if (tempCalc > addIt) {
                    addIt = tempCalc;
                }

            }
            groups.push(addIt);
        }
        _this.dominateBins.push(groups);
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
        console.log('getUserMedia() got stream: ', stream);

        _this.stream = stream;
        _this.source = _this.audioCtx.createMediaStreamSource(stream);

        _this.source.connect(_this.analyser);
        _this.analyser.connect(_this.scriptNode);

        // This is needed due to a chrome bug!
        _this.scriptNode.connect(_this.audioCtx.destination);
    }

    function errorCallback(error) {
        console.log('navigator.getUserMedia error: ', error);
    }
};

JsSpeechRecognizer.prototype.startTrainingRecording = function(curWord) {

    this.doRecognition = false;
    this.isRecording = true;

    // Create a new current buffer
    this.currentRecordingBuffer = [];

    // Create a new recognition buffer
    this.dominateBins = [];
    this.wordBuffer.push(curWord);

};

JsSpeechRecognizer.prototype.startRecognitionRecording = function() {

    this.doRecognition = true;
    this.isRecording = true;

    // Create a new current buffer
    this.currentRecordingBuffer = [];

    // Create a new recognition buffer
    this.dominateBins = [];
};

JsSpeechRecognizer.prototype.stopRecording = function() {

    this.isRecording = false;
    this.dominateBins = [].concat.apply([], this.dominateBins);

    if (this.doRecognition) {
        console.log("doing recognition");
        return;
    }

    // This is training
    this.recordingBufferArray.push(this.currentRecordingBuffer.slice(0));
    // Save the recognition model
    this.modelBuffer.push(this.dominateBins.slice(0));

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
            console.log("key: " + key);
            this.model[key].push(this.modelBuffer[i]);
        }
    }
};

JsSpeechRecognizer.prototype.getTopRecognitionHypothesis = function() {
    return this.findClosestMatch(this.dominateBins.slice(0));
};


// Calculation functions

JsSpeechRecognizer.prototype.findClosestMatch = function(input) {

    var i = 0;
    var key = "";

    var confidences = {};

    for (key in this.model) {

        confidences[key] = [];
        for (i = 0; i < this.model[key].length; i++) {

            var curDistance = this.findDistance(input, this.model[key][i]);
            var curConfidence = this.calcConfidence(curDistance, this.model[key][i]);

            // console.log("cur confidence " + curConfidence);
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

    // Print out
    console.log(maxKey + " - " + max);

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

    // console.log("distance: " + distance + " sum: " + sum);
    return (1 - (distance / sum));
};

