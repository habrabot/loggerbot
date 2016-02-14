'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var needle = require('needle');
var sqlite3 = require('sqlite3');
var winston = require('winston');
// winston.add(winston.transports.File, {
//     filename: 'logs.log',
//     handleExceptions: true,
//     humanReadableUnhandledException: true
//   });
// TODO Documentation
// TODO Permission denied u rekt
var config = JSON.parse(fs.readFileSync('config.json'));
var db = new sqlite3.Database(config.database);

/**
 * Represents a Telegram API instance
 * @constructor
 * @param {string} token - bot's token
 * @param {string} url - webhook server url
 * @param {port} port - webhook port
 */
function Telegram(token, url, port) {
  this.token = token;
  
  winston.info('Setting up a webhook at ' + url + ':' + port + '/' + token);
  
  needle.post('https://api.telegram.org/bot' + token + '/setWebhook', {'url': url + ':' + port + '/' + token}, 
    function(err, resp, body) {
     if (body.ok) {
      winston.info(body.description);
     } else {
       winston.error(body.description);
     }
    });
  db.serialize(function() {
    db.run("CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY NOT NULL UNIQUE, username TEXT, first_name TEXT NOT NULL, last_name TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY NOT NULL UNIQUE, type TEXT NOT NULL, title TEXT, username TEXT, first_name TEXT, last_name TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS messages(id INTEGER NOT NULL, 'from' INTEGER, chat INTEGER NOT NULL, date INTEGER NOT NULL, forward_from INTEGER, forward_date INTEGER, reply_to_message INTEGER, text TEXT, new_chat_participant INTEGER, left_chat_participant INTEGER, migrate_to_chat_id INTEGER)");
  });
  
}

/**
 * Represents a message from telegram servers
 * @constructor
 * @param {string} body - request from webhook
 */
function Message(body) {
  body = JSON.parse(body);
  this.body = body.message;
}

/**
 * Stores a message into a database
 */
Message.prototype.store = function() {
  var data = this.body;
  db.serialize(function() {
    if (data.from) {
      db.run("INSERT OR REPLACE INTO users(id, username, first_name, last_name) VALUES(?, ?, ?, ?)", data.from.id, data.from.username, data.from.first_name, data.from.last_name);
    }
    if (data.chat) {
      db.run('INSERT OR REPLACE INTO chats(id, type, title, username, first_name, last_name) VALUES(?, ?, ?, ?, ?, ?)', data.chat.id, data.chat.type, data.chat.title, data.chat.username, data.chat.first_name, data.chat.last_name)
    }
    db.run('INSERT INTO messages(id, "from", chat, date, forward_from, forward_date, reply_to_message, text, new_chat_participant, left_chat_participant, migrate_to_chat_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      data.message_id,
      data.from ? data.from.id : '',
      data.chat ? data.chat.id : '',
      data.date,
      data.forward_from ? data.forward_from.id : '',
      data.forward_date,
      data.reply_to_message ? data.reply_to_message.id : '',
      data.text,
      data.new_chat_participant,
      data.left_chat_participant,
      data.migrate_to_chat_id
    )
  });
}

/**
 * Logs the message
 */
Message.prototype.log = function() {
  if (this.from) {
    winston.info(this.from.username);
  }
}

// Begin
var telegram = new Telegram(config.token, config.domain, config.port);

http.createServer(function(request, response) {
  var headers = request.headers;
  var method = request.method;
  var url = request.url;
  var body = [];
  request.on('error', function(err) {
    winston.error(err);
  }).on('data', function(chunk) {
    body.push(chunk);
  }).on('end', function() {
    body = Buffer.concat(body).toString();
    response.on('error', function(err) {
      winston.error(err);
    });

    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    
    if (method = 'POST' && url == '/' + config.token) {
      var message = new Message(body);
      winston.info('Incoming message...');
      message.log();
      message.store();
    }
    var responseBody = {
      headers: headers,
      method: method,
      url: url,
      body: body
    };
    //winston.info(JSON.stringify(responseBody));
    response.end();
  });
}).listen(8443);
 
