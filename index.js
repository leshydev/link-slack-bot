'use strict';

let ntpClient = require('ntp-client'),
    RtmClient = require('./node_modules/slack-client').RtmClient,
    WebClient = require('./node_modules/slack-client').WebClient,
    CLIENT_EVENTS = require('./node_modules/slack-client').CLIENT_EVENTS,
    RTM_EVENTS = require('./node_modules/slack-client').RTM_EVENTS,
    RTM_MESSAGE_SUBTYPES = require('./node_modules/slack-client').RTM_MESSAGE_SUBTYPES,
    argv = require('minimist')(process.argv.slice(2)),
    fs = require('fs');

let CONFIG, CONFIG_FILE = 'config.json',
    rtm, web, botStarted, allImChannels, allUsers, localDate, users = new Map();

function initConfig() {
    let newBotToken, cachedBotToken = CONFIG && CONFIG.SLACK_BOT_TOKEN;

    console.log('Initializing configuration...');

    CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

    CONFIG.TEAM_CHANNELS = new Map((CONFIG.CHANNELS || []).map((channel) => [channel.id, channel]));
    CONFIG.SLACK_BOT_TOKEN = newBotToken = argv.SLACK_BOT_TOKEN || CONFIG.SLACK_BOT_TOKEN;

    if (cachedBotToken !== newBotToken) {
        console.log('Starting bot...');

        rtm = new RtmClient(newBotToken);
        web = new WebClient(newBotToken);
    }
}

function getUsersByNames(allUsers, usersNames) {
    let subscribedUsers = [];

    allUsers.forEach((user) => {
        if (usersNames.indexOf(user.name) != -1) {
            subscribedUsers.push(user);
        }
    });

    return subscribedUsers;
}

function fetchChannelsAndUsers(allUsers, date) {
    console.log('Fetching users...');

    CONFIG.TEAM_CHANNELS.forEach((teamChannel) => {
        let teamChannelId = teamChannel.id,
            subscribedUsers = getUsersByNames(allUsers, teamChannel.users || []);

        subscribedUsers.forEach((user) => {
            let userId = user.id;

            web.dm.open(userId, (arg1, channelInfo) => {
                console.log(`Fetched ${userId}:${user.name} `);
                users.set(userId, {
                    id: userId,
                    name: user.name,
                    realName: user.real_name,
                    icon_url: user.profile.image_48,
                    imChannelId: channelInfo.channel.id,
                    lastAnswerDate: date || new Date(),
                    answers: [],
                    teamChannelId: teamChannelId,
                    lastAskedQuestionIndex: null
                });
            });
        });

    });
}

function updateLocalDate(callback) {
    ntpClient.getNetworkTime(CONFIG.NTP_SERVER.HOST, CONFIG.NTP_SERVER.PORT, function (err, date) {
        if (err) {
            console.error(err);
            return;
        }

        let userOffset = CONFIG.HOURS_GMT_OFFSET * 60 * 60000,
            timeOffset = date.getTimezoneOffset() * 60000;

        localDate = new Date(date.getTime() + timeOffset + userOffset);

        if (callback) {
            callback(localDate);
        }
    });
}

function onRtmClientStart(rtmStartData) {
    if (botStarted) return;
    botStarted = true;
    console.log('Bot started');

    web.dm.list(function (err, imChannelsInfo) {
        if (err) {
            console.log('Error:', err);
        } else {
            allImChannels = imChannelsInfo.ims;

            web.users.list(function (err, usersInfo) {
                if (err) {
                    console.log('Error:', err);
                } else {
                    allUsers = usersInfo.members;

                    updateLocalDate(date => fetchChannelsAndUsers(allUsers, date));
                }
            });
        }
    });
}

function buildPost(user, questions) {
    let day = localDate.getDate(),
        monthIndex = localDate.getMonth(),
        year = localDate.getFullYear(),
        monthNames = [
            "Jan", "Feb", "Mar",
            "Apr", "May", "Jun",
            "Jul", "Aug", "Sep",
            "Oct", "Nov", "Dec"
        ],
        userPost = {
            text: `*${user.realName || user.name}* posted a status update for *${monthNames[monthIndex]} ${day}, ${year}*`,
            attachments: []
        };

    questions.forEach((question, index) => {
        let answer = user.answers[index];

        if (answer === '' || answer === '-') return;
        userPost.attachments.push({
            title: question,
            color: "#839bbd",
            text: user.answers[index]
        });
    });

    return userPost;
}

function answerQuestion(user, message) {
    let channelId = user.teamChannelId,
        teamChannelQuestions = CONFIG.TEAM_CHANNELS.get(channelId).questions,
        lastAskedQuestionIndex = user.lastAskedQuestionIndex,
        messageText;

    user.answers.push(message.text);

    if (lastAskedQuestionIndex === teamChannelQuestions.length - 1) {
        let post = buildPost(user, teamChannelQuestions);

        web.chat.postMessage(channelId, post.text, {
            parse: 'none',
            mrkdwn: true,
            username: user.name,
            icon_url: user.icon_url,
            attachments: JSON.stringify(post.attachments)
        });

        user.answers = [];
        lastAskedQuestionIndex = null;
        messageText = 'Awesome! Have a great day';
    } else {
        lastAskedQuestionIndex++;
        messageText = teamChannelQuestions[lastAskedQuestionIndex];
    }

    rtm.sendMessage(messageText, message.channel);
    user.lastAskedQuestionIndex = lastAskedQuestionIndex;
    user.lastAnswerDate = new Date(localDate.getTime());
}

function handleRtmMessage(message) {
    let isImChannel = allImChannels.findIndex((botImChannel) => {
        if (botImChannel.id === message.channel) {
            return true;
        }
    });

    if (isImChannel === -1) return;

    if (message.subtype === RTM_MESSAGE_SUBTYPES.MESSAGE_CHANGED) {
        let previousMessage = message.previous_message.text,
            user = users.get(message.previous_message.user),
            answerIndex;

        if (!user || !user.teamChannelId || user.lastAskedQuestionIndex === null) return;

        answerIndex = user.answers.indexOf(previousMessage);
        user.answers[answerIndex] = message.message.text;
    } else {
        let user = users.get(message.user);

        if (!user || !user.teamChannelId || user.lastAskedQuestionIndex === null) {
            rtm.sendMessage('See you later...', message.channel);
            return;
        }

        answerQuestion(user, message);
    }
}

function sendNotifications() {
    if (!localDate) {
        return;
    }

    if (localDate.getHours() >= CONFIG.SCHEDULE_HOUR) {
        for (let user of users.values()) {
            let teamChannelQuestions = CONFIG.TEAM_CHANNELS.get(user.teamChannelId).questions,
                currentLocalDateStr = `${localDate.getFullYear()}.${localDate.getMonth()}.${localDate.getDate()}`,
                lastAnswerDate = user.lastAnswerDate,
                lastAnswerDateStr;

            if (CONFIG.SKIP_WEEKEND && (localDate.getDay() === 6 || localDate.getDay() === 0)) return;

            if (lastAnswerDate) {
                lastAnswerDateStr = `${lastAnswerDate.getFullYear()}.${lastAnswerDate.getMonth()}.${lastAnswerDate.getDate()}`;
            }

            if (user.lastAskedQuestionIndex === null && (lastAnswerDate === null || currentLocalDateStr > lastAnswerDateStr)) {
                rtm.sendMessage(`<@${user.id}> ${teamChannelQuestions[0]}`, user.imChannelId);
                user.lastAskedQuestionIndex = 0;
            }
        }
    }
}

initConfig();
setInterval(() => updateLocalDate(), 1000 * 30);
setInterval(() => sendNotifications(), 1000 * 60);
rtm.start();
rtm.on(RTM_EVENTS.MESSAGE, handleRtmMessage);
rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, onRtmClientStart);