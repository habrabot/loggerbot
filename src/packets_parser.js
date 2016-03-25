var sqlite3 = require('sqlite3'),
    TelegramPacketProcessor = require('./telegram_packet_processor.js'),
    winston = require('winston');

var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.File)({
      name: 'info-file',
      filename: 'logger.log',
      level: 'info'
    }),
    new (winston.transports.Console)({
      name: 'info-console',
      level: 'info',
      colorize: true,
      timestamp: true
    })
  ]
});

var packetsProcessor = new TelegramPacketProcessor({}, '../db/parsed.db');

// packetsProcessor.downloadAndPrepare();
// packetsProcessor.processDocumentationFromFile();
// packetsProcessor.loadTablesData();
// console.log(packetsProcessor.tablesData);

var counter = 0;
packetsProcessor.insertCallback = function(error) {
	if (error) {
		logger.error(error);
	} else {
		logger.info(++counter);
	}
}

var counter = 0;
var insertCallback = function(error) {
	logger.info(++counter);
}

var db = new sqlite3.Database('../db/database.sqlite');
db.all("select * from raw_packets;", [], function(error, data) {
	if (error) {
		logger.error(error);
	} else {
		for (var i = 0; i < data.length; i++) {
			var json = data[i].data;
			packetsProcessor.saveRawPacket(json, insertCallback);
		}
	}
})
