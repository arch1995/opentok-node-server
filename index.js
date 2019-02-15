/* eslint-disable no-console, no-path-concat */

// Dependencies
var express = require('express');
var OpenTok = require('opentok');
var cors = require('cors') 
var app = express();
var bodyParser = require('body-parser');
var axios = require('axios');

var connectionIdArrayTimeouts = {};

app.options('*', cors())
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Expose-Headers", "X-My-Custom-Header, X-Another-Custom-Header");
  next(); // make sure we go to the next routes and don't stop here
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var opentok;
var apiKey = "46265372";
var apiSecret = "d80e1959c9cf5063cb89337899664d8bbc4d4e21";

// Verify that the API Key and API Secret are defined
if (!apiKey || !apiSecret) {
  console.log('You must specify API_KEY and API_SECRET environment variables');
  process.exit(1);
}

// Starts the express app
function init() {
  let port = process.env.PORT || 3080;
  app.listen(port, function () {
    console.log('You\'re app is now ready at' + port);
  });
}

// Initialize OpenTok
opentok = new OpenTok(apiKey, apiSecret);

// Create a session and store it in the express app
opentok.createSession(function (err, session) {
  if (err) throw err;
  console.log("Session", session);
  app.set('sessionId', session.sessionId);
  // We will wait on starting the app until this is done
  init();
});


app.get('/', function (req, res) {
  var sessionId = app.get('sessionId');
  // generate a fresh token for this client
  var token = opentok.generateToken(sessionId);
  console.log("token", token);
  res.json({
    apiKey: apiKey,
    sessionId: sessionId,
    token: token,
  });
});

function sendConnectedOrReconnectedSignal(connectionID, isConnectedBack = false) {
  var sessionId = app.get('sessionId');
  var object = connectionIdArrayTimeouts[connectionID];
  var type = isConnectedBack ? 'streamReconnected' : 'streamTemporarilyDisconnected'
  connectionIdArrayTimeouts[connectionID]["isTemporarilyDisconnected"] = !isConnectedBack;
  console.log("connection_id", connectionIdArrayTimeouts);
  
  var payload = {
    data: JSON.stringify({ 
      streamName: object.streamName,
      streamId: object.streamId,
      projectId: object.projectId,
      connectionId: connectionID,
      event: type
    }),
    type
  }
  opentok.signal(sessionId, null, payload, function(err, data) {
    if (err) {
      console.log("err", err);
    } else {
      console.log("data", data);
    }
  })
}

function setTimer(connectionId) {
  connectionIdArrayTimeouts[connectionId]["timeout"] = setTimeout(function () {
    if (!connectionIdArrayTimeouts[connectionId].isTemporarilyDisconnected) {
      sendConnectedOrReconnectedSignal(connectionId);
    }
  }, 6000)
}

function sendSignal(connectionId, signalType = "verifyConnection") {
  var sessionId = app.get('sessionId');
  var payload = {
    data: JSON.stringify({ connectionId }),
    type: signalType
  }

  opentok.signal(sessionId, connectionId, payload, function(err, data) {
  if (err) {
    console.log("send_signal_err", err);
    
  } else {
      if (!connectionIdArrayTimeouts[connectionId]["timeout"]) {
        setTimer(connectionId);
      }
    }
  })
} 

function clearTimer(connectionID) {
  clearTimeout(connectionIdArrayTimeouts[connectionID]["timeout"]);
  connectionIdArrayTimeouts[connectionID]["timeout"] = null;
} 

app.post('/events', function(req, res) {
  console.log("Events_req", req.body);
  let object = req.body;
  console.log("\n\n\n");
  if (object.event === 'streamCreated') {
    var connectionId = object.stream.connection.id;
    var streamName = object.stream.name
    var streamId = object.stream.id;
    var projectId = object.projectId;
    if (!connectionIdArrayTimeouts[connectionId]) {
      connectionIdArrayTimeouts[connectionId] = {
        streamName: streamName,
        streamId: streamId,
        projectId: projectId, 
        isTemporarilyDisconnected: false
      }
      connectionIdArrayTimeouts[connectionId]["interval"] = setInterval(function() {
        sendSignal(connectionId);
      }, 3000)
      
    }
  } else if (object.event === "streamDestroyed") {
    var sessionId = object.sessionId;
    var connectionId = object.stream.connection.id;
    if(connectionIdArrayTimeouts[connectionId]) {
      clearInterval(connectionIdArrayTimeouts[connectionId]["interval"]);
      clearTimeout(connectionIdArrayTimeouts[connectionId]["timeout"])
    }
    delete connectionIdArrayTimeouts[connectionId];
  } else {
    res.send({ statusCode: 200 })
  }
})

app.post('/connectionVerified', function(req, res) {
  console.log("body", req.body);
  var connectionID = req.body.connectionId;
  if (!connectionIdArrayTimeouts[connectionID]) {
    res.send({ message: 'Wrong id sent', code: 400 })
  } else {
    res.send({ statusCode: 200 });
    clearTimer(connectionID);
    if (connectionIdArrayTimeouts[connectionID]["isTemporarilyDisconnected"]) {
      sendConnectedOrReconnectedSignal(connectionID, true);
    }
  }
})