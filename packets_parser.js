var sqlite3 = require('sqlite3');
var TelegramPacketProcessor = require('./telegram_packet_processor.js');

var packetsProcessor = new TelegramPacketProcessor({}, 'parsed.db');

// packetsProcessor.downloadAndPrepare();
packetsProcessor.processDocumentationFromFile();
// packetsProcessor.loadTablesData();
// console.log(packetsProcessor.tablesData);

var counter = 0;
packetsProcessor.insertCallback = function(error) {
	if (error) {
		console.error(error);
	} else {
		console.log(++counter);
	}
}

var counter = 0;
var insertCallback = function(error) {
	console.log(++counter);
}

var db = new sqlite3.Database('database.sqlite');
db.all("select * from raw_packets;", [], function(error, data) {
	if (error) {
		console.log(error);
	} else {
		for (var i = 0; i < data.length; i++) {
			var json = data[i].data;
			packetsProcessor.saveRawPacket(json, insertCallback);
		}
	}
})

