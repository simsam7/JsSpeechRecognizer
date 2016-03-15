# JsSpeechRecognizer
JavaScript Speech Recognizer

## What is It?
JsSpeechRecognizer is a javascript based speech recognizer. It allows you to train words or phrases to be recognized, and then record new audio to match to these words or phrases.

At the moment, JsSpeechRecognizer does not include any data model, so you will have to train new words before using it.

## How Does it Work?

### WebRTC
JsSpeechRecognizer uses browser WebRTC functionality to get access to the microphone and Fast Fourier Transform (fft) data. Therefore, it will only work in browsers with WebRTC support.

The WebRTC adapter javascript is neede to use the JSSpeechRecognizer. It is hosted on github here. https://github.com/webrtc/adapter

### JsSpeechRecognizer.js
This file contains all of the specific speech recognizer logic.

### Detailed Write Up
I am planning on making a more detailed write up of how it works in the near future.

## Running the Demos
The demo speechrec.html lets you train new words and then recognize them.

### Running in Firefox
Simply open the file speechrec.html. You should get a popup from the browser asking you if you would like to grant the site permission to use the microphone.

### Running in Chrome
If the speechrec.html file is opened as a local file (with a file:/// prefix) the demo will not work by default due to security settings. You can either disable the security (temporarily) or set up a local server to test the file.

I recommend using a Python SimpleHTTPServer. Open up a terminal, cd to the proper folder you want to host, and run the following command:

````shell
python -m SimpleHTTPServer 8000
````

Open up a "localhost:8000" in your browser to see the list of files in the folder being shared. For more details see the python documentation.
https://docs.python.org/2/library/simplehttpserver.html

For more details about Chrome and webrtc locally, see the following stack overflow question:
http://stackoverflow.com/questions/14318319/webrtc-browser-doesnt-ask-for-mic-access-permission-for-local-html-file

### Other Browsers
I have not tested other browsers.
