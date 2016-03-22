How to launch bot:
```
# ensure you have nodejs and git installed
git clone https://github.com/habrabot/loggerbot.git ./loggerbot
cd loggerbot
mkdir cert #Create 'cert' dir
cd ./cert #and generate ssl keys for https connection:
openssl req -newkey rsa:2048 -sha256 -nodes -keyout private.key -x509 -days 365 -out public.pem -subj "/C=US/ST=New York/L=Brooklyn/O=Example Brooklyn Company/CN=YOURDOMAIN.EXAMPLE"
# (Don't forget to change YOURDOMAIN.EXAMPLE to your site name or ip address)
cd .. # changing dir back to ./loggerbot
touch config-myword.json #create config-YOURWORD.json file
echo '{"domain": "99.99.99.99", "port":228, "token": "XXXX:YYYYYYYYYYYYY"}' > config-myword.json #and set "domain", "port", "token" json fields
npm install
node logger.js
```

TODO: add longpolling connection method.
