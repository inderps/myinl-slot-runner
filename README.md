# MyINL slot runner

Checks multiple course pages and preferred sessions defined in [config.json](config.json). In booking mode, it enrolls in the first available configured slot, using the order in that file.

The default mode is read-only. It reports whether each configured session has an active **Enroll** form. It only sends an enrollment POST when run with the **--book** option.

## Setup

Requires Node.js 18 or newer. There are no package dependencies to install.

~~~
cp .env.example .env
~~~

Set MYINL_SESSION_ID in .env to the value of the session_id cookie from an authenticated MyINL browser session. Do not commit or share this file. The runner loads .env automatically.

## Configure courses and slots

Edit config.json. Each object in courses represents one course page. The order of courses, then the order of slots inside each course, is the enrollment priority.

~~~
{
  "courses": [
    {
      "name": "A display name",
      "language": "Language name",
      "url": "https://myinl.inll.lu/language/.../...",
      "slots": [
        { "location": "INLL Belval", "schedule": "10:10-11:50 Mo-We" },
        { "location": "INLL Glacis", "schedule": "19:00-20:40 Tu-Th" }
      ]
    }
  ]
}
~~~

You can add as many course objects and slots as you need. The location and schedule text must exactly match the corresponding row on MyINL.

## Run

Check availability only:

~~~
npm run check
~~~

Submit enrollment for the first available configured slot:

~~~
npm run book
~~~

The site can still reject an enrollment because availability can change between the check and the POST. The program prints MyINL's response message.
