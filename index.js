'use strict';

let RtmClient = require('./node_modules/slack-client').RtmClient,
    WebClient = require('./node_modules/slack-client').WebClient,
    CLIENT_EVENTS = require('./node_modules/slack-client').CLIENT_EVENTS,
    RTM_EVENTS = require('./node_modules/slack-client').RTM_EVENTS,
    RTM_MESSAGE_SUBTYPES = require('./node_modules/slack-client').RTM_MESSAGE_SUBTYPES,
    argv = require('minimist')(process.argv.slice(2)),
    fs = require('fs');

let CONFIG, CONFIG_FILE = 'config.json',
    rtm, web, allImChannels, allUsers, users = new Map();

function initConfig() {
    let newBotToken, cachedBotToken = CONFIG && CONFIG.SLACK_BOT_TOKEN;

    CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

    CONFIG.TEAM_CHANNELS = new Map((CONFIG.CHANNELS || []).map((channel) => [channel.id, channel]));
    CONFIG.SLACK_BOT_TOKEN = newBotToken = argv.SLACK_BOT_TOKEN || CONFIG.SLACK_BOT_TOKEN;

    if (cachedBotToken !== newBotToken) {
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

function fetchChannelsAndUsers(allUsers) {
    CONFIG.TEAM_CHANNELS.forEach((teamChannel) => {
        let teamChannelId = teamChannel.id,
            subscribedUsers = getUsersByNames(allUsers, teamChannel.users || []);

        subscribedUsers.forEach((user) => {
            let userId = user.id;

            web.dm.open(userId, (arg1, channelInfo) => {
                users.set(userId, {
                    id : userId,
                    name : user.name,
                    realName : user.real_name,
                    icon_url : user.profile.image_48,
                    imChannelId : channelInfo.channel.id,
                    lastAnswerDate : null,
                    answers : [],
                    teamChannelId : teamChannelId,
                    lastAskedQuestionIndex : null
                });
            });
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

function onRtmClientStart(rtmStartData) {
    web.dm.list(function(err, imChannelsInfo) {
        if (err) {
            console.log('Error:', err);
        } else {
            allImChannels = imChannelsInfo.ims;

            web.users.list(function(err, usersInfo) {
                if (err) {
                    console.log('Error:', err);
                } else {
                    allUsers = usersInfo.members;

                    fetchChannelsAndUsers(allUsers);
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
            text : `*${user.realName || user.name}* posted a status update for *${monthNames[monthIndex]} ${day}, ${year}*`,
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

function answerQuestion(user, message) {
    let channelId = user.teamChannelId,
        teamChannelQuestions = CONFIG.TEAM_CHANNELS.get(channelId).questions,
        lastAskedQuestionIndex = user.lastAskedQuestionIndex,
        messageText;

    user.answers.push(message.text);

    if (lastAskedQuestionIndex === teamChannelQuestions.length - 1) {
        let post = buildPost(user, teamChannelQuestions);

        web.chat.postMessage(channelId, post.text, {
            parse : 'none',
            mrkdwn : true,
            username : user.name,
            icon_url : user.icon_url,
            attachments : JSON.stringify(post.attachments)
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
    user.lastAnswerDate = getUserDate();
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

        if (!user || !user.teamChannelId || user.lastAskedQuestionIndex === null) return;

        answerQuestion(user, message);
    }
}

function askUsers() {
    let userDate = getUserDate();

    console.log(userDate);

    for (let user of users.values()) {
        let teamChannelQuestions = CONFIG.TEAM_CHANNELS.get(user.teamChannelId).questions,
            currentUserDateStr = `${userDate.getFullYear()}.${userDate.getMonth()}.${userDate.getDate()}`,
            lastAnswerDate = user.lastAnswerDate,
            lastAnswerDateStr;

        if (CONFIG.SKIP_WEEKEND && (userDate.getDay() === 6 || userDate.getDay() === 0)) {
            console.log('weekend slipped');
            return;
        }

        if (lastAnswerDate) {
            lastAnswerDateStr = `${lastAnswerDate.getFullYear()}.${lastAnswerDate.getMonth()}.${lastAnswerDate.getDate()}`;
        }

        console.log('checking answers');
        if (user.lastAskedQuestionIndex === null && (lastAnswerDate === null || currentUserDateStr > lastAnswerDateStr)) {
            console.log('sending question to ' + user.username);
            rtm.sendMessage(`<@${user.id}> ${teamChannelQuestions[0]}`, user.imChannelId);
            user.lastAskedQuestionIndex = 0;
            console.log('asked');
        }
    }
}

function startStandupTrigger() {
    askUsers();

    setInterval(() => {
        askUsers();
    }, 1000 * 60 * 60 * 24);
}

initConfig();
startStandupTrigger();
rtm.start();
rtm.on(RTM_EVENTS.MESSAGE, handleRtmMessage);
rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, onRtmClientStart);