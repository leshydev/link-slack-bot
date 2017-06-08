'use strict';

let RtmClient = require('./node_modules/slack-client').RtmClient,
    WebClient = require('./node_modules/slack-client').WebClient,
    CLIENT_EVENTS = require('./node_modules/slack-client').CLIENT_EVENTS,
    RTM_EVENTS = require('./node_modules/slack-client').RTM_EVENTS,
    argv = require('minimist')(process.argv.slice(2)),
    fs = require('fs');

let CONFIG = JSON.parse(fs.readFileSync('config.json', 'utf8')),
    bot_token = argv.SLACK_BOT_TOKEN || CONFIG.SLACK_BOT_TOKEN,
    TEAM_CHANNELS = new Map((CONFIG.CHANNELS || []).map((channel) => [channel.id, channel])),
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
            answers : [],
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
    TEAM_CHANNELS.forEach((teamChannel) => {
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
                    let teamChannelQuestions = TEAM_CHANNELS.get(userTeamChannelId).questions,
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
    web.groups.list(function(err, channelsInfo) {
        if (err) {
            console.log('Error:', err);
        } else {
            let allChannels = channelsInfo.groups;

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

function buildPost(user, questions) {
    let date = getUserDate(),
        day = date.getDate(),
        monthIndex = date.getMonth(),
        year = date.getFullYear(),
        monthNames = [
            "Jan", "Feb", "Mar",
            "Apr", "May", "Jun",
            "Jul", "Aug", "Sep",
            "Oct", "Nov", "Dec"
        ],
        userPost = {
            text : `<@${user.id}> posted a status update for *${monthNames[monthIndex]} ${day}, ${year}*`,
            attachments : []
        };

    questions.forEach((question, index) => {
        let answer = user.answers[index];

        if (answer === '' || answer === '-') return;
        userPost.attachments.push({
            title : question,
            color : "#839bbd",
            text : user.answers[index]
        });
    });

    return userPost;
}

function answerQuestion(user, channel, message) {
    let channelId = channel.id,
        teamChannelQuestions = TEAM_CHANNELS.get(channelId).questions,
        lastAskedQuestionIndex = channel.lastAskedQuestionIndex,
        messageText;

    user.answers.push(message.text);

    if (lastAskedQuestionIndex === teamChannelQuestions.length - 1) {
        let post = buildPost(user, teamChannelQuestions);
        web.chat.postMessage(channelId, post.text, {
            parse : 'none',
            mrkdwn : true,
            attachments : JSON.stringify(post.attachments)
        });
        lastAskedQuestionIndex = null;
        messageText = 'Awesome! Have a great day';
    } else {
        lastAskedQuestionIndex++;
        messageText = teamChannelQuestions[lastAskedQuestionIndex];
    }

    rtm.sendMessage(messageText, message.channel);
    channel.lastAskedQuestionIndex = lastAskedQuestionIndex;
    user.lastAnswerDate = getUserDate();
}

rtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {
    let user = users.get(message.user);
    if (!user || !user.channels) return;

    for (let userTeamChannel of user.channels.values()) {
        if (userTeamChannel.lastAskedQuestionIndex === null) return;
        answerQuestion(user, userTeamChannel, message);
    }
});

rtm.start();
rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, onRtmClientStart);