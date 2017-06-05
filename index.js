'use strict';

let RtmClient = require('./node_modules/slack-client').RtmClient,
    WebClient = require('./node_modules/slack-client').WebClient,
    RTM_EVENTS = require('./node_modules/slack-client').RTM_EVENTS,
    fs = require('fs');

let config = JSON.parse(fs.readFileSync('config.json', 'utf8')),
    bot_token = process.env.SLACK_BOT_TOKEN || config.SLACK_BOT_TOKEN,
    link_channel_id = process.env.OUTPUT_CHANNEL || config.OUTPUT_CHANNEL,
    timeOffset = config.GMT_HOURS_OFFSET * 60 * 60000,
    questions = config.QUESTIONS || [],
    rtm = new RtmClient(bot_token),
    web = new WebClient(bot_token);

/*setInterval(() => {
 let currentDate = new Date(),
 userOffset = currentDate.getTimezoneOffset() * 60000,
 belarusTime = new Date(currentDate.getTime() - timeOffset + userOffset);
 }, 1000);*/

web.channels.list(function(err, info) {
    if (err) {
        console.log('Error:', err);
    } else {
        let channels = info.channels;
        for(let i in channels) {
            let channel = channels[i];
            if (channel.id === link_channel_id) {
                let members = channel.members;
                for(let a in members) {
                    web.chat.postMessage(members[a], 'Hey!');
                }
            }
        }
    }
});


web.dm.list(function(err, info) {
    debugger
});

var counter = 0;
rtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {
    console.log(message);
    if (counter === questions.length - 1) {
        rtm.sendMessage('Awesome! Have a great day', message.channel);
        counter = 0;
    } else {
        rtm.sendMessage(questions[counter], message.channel);
        counter++;
    }
});

rtm.start();