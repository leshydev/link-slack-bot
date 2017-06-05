'use strict';

let RtmClient = require('./node_modules/slack-client').RtmClient,
    WebClient = require('./node_modules/slack-client').WebClient,
    CLIENT_EVENTS = require('./node_modules/slack-client').CLIENT_EVENTS,
    RTM_EVENTS = require('./node_modules/slack-client').RTM_EVENTS,
    fs = require('fs');

let CONFIG = JSON.parse(fs.readFileSync('config.json', 'utf8')),
    bot_token = process.env.SLACK_BOT_TOKEN || CONFIG.SLACK_BOT_TOKEN,
    teamChannels = new Map((CONFIG.CHANNELS || []).map((channel) => [channel.id, channel])),
    timeOffset = CONFIG.GMT_HOURS_OFFSET * 60 * 60000,
    users = new Map(),
    rtm = new RtmClient(bot_token),
    web = new WebClient(bot_token);

function fetchUserChannels(userId, teamChannelId, botImChannelId) {
    let user = users.get(userId);

    if (!user) {
        user = {
            id : userId,
            imChannelId : botImChannelId,
            channels : new Map()
        };
    }

    user.channels.set(teamChannelId, {
        id : teamChannelId,
        lastAskedQuestionIndex : 0
    });

    users.set(userId, user);
}

function fetchChannels(allChannels, imChannels) {
    teamChannels.forEach((teamChannel) => {
        allChannels.forEach((channel) => {
            let teamChannelId = teamChannel.id;

            if (channel.id === teamChannelId) {
                imChannels.forEach((botImChannel) => {
                    let subscribedUsers = channel.members,
                        userId = botImChannel.user,
                        botImChannelId = botImChannel.id;

                    if (subscribedUsers.indexOf(userId) !== -1) {
                        fetchUserChannels(userId, teamChannelId, botImChannelId);
                    }
                });
            }
        });
    })
}

function initQuestionsTrigger() {
    setInterval(() => {
    }, 10000);

    let currentDate = new Date(),
        userOffset = currentDate.getTimezoneOffset() * 60000,
        belarusTime = new Date(currentDate.getTime() + timeOffset - userOffset);

    for (let user of users.values()) {
        for (let userTeamChannelId of user.channels.keys()) {
            let teamChannelQuestions = teamChannels.get(userTeamChannelId).questions;
            rtm.sendMessage(`<@${user.id}> ${teamChannelQuestions[0]}`, user.imChannelId);
        }
    }
}

function onRtmClientStart(rtmStartData) {
    web.channels.list(function(err, channelsInfo) {
        if (err) {
            console.log('Error:', err);
        } else {
            let allChannels = channelsInfo.channels;

            web.dm.list(function(err, imChannelsInfo) {
                if (err) {
                    console.log('Error:', err);
                } else {
                    let imChannels = imChannelsInfo.ims;

                    setTimeout(() => {
                        fetchChannels(allChannels, imChannels);
                        initQuestionsTrigger();
                    }, 5000);
                }
            });
        }
    });
}

rtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {
    //if (message.channel === link_channel_id) return;
    let user = users.get(message.user);

    for (let [userTeamChannelId, userTeamChannel] of user.channels) {
        let teamChannelQuestions = teamChannels.get(userTeamChannelId).questions,
            lastAskedQuestionIndex = userTeamChannel.lastAskedQuestionIndex;

        if (lastAskedQuestionIndex === teamChannelQuestions.length - 1) {
            rtm.sendMessage('Awesome! Have a great day', message.channel);
            rtm.sendMessage(`<@${message.user}>'s status for today: bla-bla-bla`, userTeamChannelId);
        } else {
            let nextMessageIndex = ++userTeamChannel.lastAskedQuestionIndex;
            rtm.sendMessage(teamChannelQuestions[nextMessageIndex], message.channel);
        }
    }
});

rtm.start();
rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, onRtmClientStart);