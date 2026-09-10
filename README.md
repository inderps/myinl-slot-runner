# MyINL slot runner

Monitors the MyINL course sessions defined in [config.json](config.json). It identifies sessions by their unique MyINL reference and can submit an enrollment when a preferred session becomes available.

By default, the runner checks every 15 seconds. Change pollIntervalSeconds in config.json to adjust the interval.

## Requirements

- Node.js 18 or newer
- An active authenticated MyINL browser session
- Optional: the Pushover iPhone app and credentials for notifications

## Setup

From the project directory, install the project dependencies:

~~~
npm install
~~~

Create the local environment file:

~~~
cp .env.example .env
~~~

Open .env and set MYINL_SESSION_ID to the value of the session_id cookie from a currently authenticated MyINL browser session:

~~~
MYINL_SESSION_ID=your-current-session-cookie-value
MYINL_TIMEZONE=Europe/Luxembourg
~~~

The runner loads .env automatically. Never commit or share it; it is excluded by .gitignore.

## iPhone notifications

Install Pushover on your iPhone, create an application in your Pushover dashboard, then add its credentials to .env:

~~~
PUSHOVER_USER_KEY=your-pushover-user-key
PUSHOVER_APP_TOKEN=your-pushover-application-api-token
~~~

The runner sends a notification when it finds an available preferred session. In booking mode, it sends a second notification containing MyINL's booking response.

## Configure courses and slots

Edit config.json. The order of courses, then the order of slots within each course, is the booking priority.

~~~
{
  "pollIntervalSeconds": 15,
  "courses": [
    {
      "name": "A display name",
      "language": "Language name",
      "url": "https://myinl.inll.lu/language/.../...",
      "slots": [
        {
          "location": "INLL Belval",
          "schedule": "10:10-11:50 Mo-We",
          "reference": "LB0015-8522"
        }
      ]
    }
  ]
}
~~~

Every slot must include its unique MyINL reference. The runner uses the reference, rather than displayed schedule text, to match the session.

## Commands

One availability check, with no enrollment:

~~~
npm run check
~~~

Keep checking until a preferred session appears, but do not enroll:

~~~
npm run watch
~~~

Keep checking until a preferred session appears, then submit one enrollment request:

~~~
npm run book
~~~

The explicit alias below behaves the same as npm run book:

~~~
npm run watch:book
~~~

Press Ctrl+C to stop a watcher. A session may disappear between the availability check and the enrollment request; the runner always prints and, if configured, sends MyINL's response.

## Run on a server with tmux

After cloning the project and creating `.env` on the server, start a named tmux session:

~~~
ssh singh@your-server
cd ~/myinl-slot-runner
tmux new -s myinl
npm run watch
~~~

To run in booking mode, use `npm run book` instead. Detach without stopping the runner by pressing `Ctrl+B`, then `D`. Reconnect later with:

~~~
ssh singh@your-server
tmux attach -t myinl
~~~
