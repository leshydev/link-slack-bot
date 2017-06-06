'use strict';

let RtmClient = require('./node_modules/slack-client').RtmClient,
    WebClient = require('./node_modules/slack-client').WebClient,
    CLIENT_EVENTS = require('./node_modules/slack-client').CLIENT_EVENTS,
    RTM_EVENTS = require('./node_modules/slack-client').RTM_EVENTS,
    fs = require('fs');

let CONFIG = JSON.parse(fs.readFileSync('config.json', 'utf8')),
    bot_token = process.env.SLACK_BOT_TOKEN || CONFIG.SLACK_BOT_TOKEN,
    teamChannels = new Map((CONFIG.CHANNELS || []).map((channel) => [channel.id, channel])),
    users = new Map(),
    rtm = new RtmClient(bot_token),
    web = new WebClient(bot_token);

function fetchUserChannels(userId, teamChannelId, botImChannelId) {
    let user = users.get(userId);

    if (!user) {
        user = {
            id : userId,
            imChannelId : botImChannelId,
            lastAnswerDate : null,
            channels : new Map()
        };
    }

    user.channels.set(teamChannelId, {
        id : teamChannelId,
        lastAskedQuestionIndex : null
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
    });
}

function getUserDate() {
    let currentDate = new Date(),
        userOffset = CONFIG.HOURS_GMT_OFFSET * 60 * 60000,
        timeOffset = currentDate.getTimezoneOffset() * 60000,
        userDate = new Date(currentDate.getTime() + timeOffset + userOffset);

    return userDate;
}

function initQuestionsTrigger() {
    setInterval(() => {
        let userDate = getUserDate();

        if (userDate.getHours() >= CONFIG.SCHEDULE_HOUR) {
            for (let user of users.values()) {
                for (let [userTeamChannelId, userTeamChannel] of user.channels) {
                    let teamChannelQuestions = teamChannels.get(userTeamChannelId).questions,
                        currentUserDateStr = `${userDate.getFullYear()}.${userDate.getMonth()}.${userDate.getDate()}`,
                        lastAnswerDate = user.lastAnswerDate,
                        lastAnswerDateStr;

                    if (CONFIG.SKIP_WEEKEND && userDate.getDay() > 5) return;

                    if (lastAnswerDate) {
                        lastAnswerDateStr = `${lastAnswerDate.getFullYear()}.${lastAnswerDate.getMonth()}.${lastAnswerDate.getDate()}`;
                    }

                    if (userTeamChannel.lastAskedQuestionIndex === null && (lastAnswerDate === null || currentUserDateStr > lastAnswerDateStr)) {
                        rtm.sendMessage(`<@${user.id}> ${teamChannelQuestions[0]}`, user.imChannelId);
                        userTeamChannel.lastAskedQuestionIndex = 0;
                    }
                }
            }
        }
    }, 1000 * 60);
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

                    fetchChannels(allChannels, imChannels);
                    initQuestionsTrigger();
                }
            });
        }
    });
}

rtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {
    let user = users.get(message.user);
    if (!user || !user.channels) return;

    for (let [userTeamChannelId, userTeamChannel] of user.channels) {
        let teamChannelQuestions = teamChannels.get(userTeamChannelId).questions,
            lastAskedQuestionIndex = userTeamChannel.lastAskedQuestionIndex,
            messageText;

        if (lastAskedQuestionIndex === null) continue;

        if (lastAskedQuestionIndex === teamChannelQuestions.length - 1) {
            web.chat.postMessage(userTeamChannelId, `<@${user.id}> posted status: bla-bla`);
            lastAskedQuestionIndex = null;
            messageText = 'Awesome! Have a great day';
        } else {
            lastAskedQuestionIndex++;
            messageText = teamChannelQuestions[lastAskedQuestionIndex];
        }

        rtm.sendMessage(messageText, message.channel);
        userTeamChannel.lastAskedQuestionIndex = lastAskedQuestionIndex;
        user.lastAnswerDate = getUserDate();
    }
});

rtm.start();
rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, onRtmClientStart);