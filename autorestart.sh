#!/usr/bin/env bash
#You need run this script by cron
BASEDIR=$(dirname "$0")
cd "$BASEDIR" 
git pull
pkill logger.js
node src/logger.js

