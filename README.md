# link-slack-bot
Automates standup meetings by sending messages to subscribed users.


### Usage
First you need to create a bot for Slack. Here is full description how to do it: https://api.slack.com/slack-apps

```code
git clone https://github.com/leshydev/link-slack-bot

cd link-slack-bot
```

Edit config.json file placed in root folder. Look example below.

```code
npm install

node index.js
```

### Configuration
Here is an example of config.json:
```code
{
  "SLACK_BOT_TOKEN": "XXXXXX",
  "CHANNELS": [
    {
      "id": "XXXXXX",
      "questions": [
        "Получилось ли у Вас выполнить все запланированные на вчера задачи?",
        "Какие планы на сегодня?",
        "Есть ли какие-либо препятствия, которые могут помешать выполнению запланированных задач? Требуется ли Вам помощь коллег?",
        "Есть ли среди выполненных вчера задач такие, о которых Вы хотели бы рассказать коллегам (что-либо интересное или важное для всех участников группы)?"
      ]
    }
  ],
  "SCHEDULE_HOUR": 10,
  "HOURS_GMT_OFFSET": 3,
  "SKIP_WEEKEND": true
}
```

```code
SLACK_BOT_TOKEN: bot's token created in Slack team
CHANNELS: list of channels where bot publishes standup results
CHANNELS.id: channel id
CHANNELS.questions: list of questions bot asks each user in group
SCHEDULE_HOUR: standup time (hour 0-24)
HOURS_GMT_OFFSET: indicates current timezone
SKIP_WEEKEND: boolean value indicates if bot ask users on weekends
```
### Restriction
User can't be in two standup groups at one time