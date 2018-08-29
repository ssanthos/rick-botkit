const EventEmitter = require('events');
const qs = require('qs');
const Promise = require('bluebird');
const moment = require('moment');

const chrono = require('chrono-node');
const Tokens = require('csrf');
const axios = require('axios');
const octokit = require('@octokit/rest')()

const SlackConfig = require('../slack-config.json');


const tokens = new Tokens();

const githubAuthEvent = new EventEmitter();


function listenForTest(controller) {
    controller.hears(
        ['test'],
        'direct_message,direct_mention,mention',
        function(bot, message) {
            const user = {
                id: message.user,
                name: 'testname',
            };
            controller.storage.users.save(user, (err) => {
                bot.reply(message, err ? 'Something went wrong' : 'Done!');
            });
        }
    );
}

function listenForErase(controller) {
    controller.hears(
        ['erase'],
        'direct_message,direct_mention,mention',
        function(bot, message) {
            handleErase(controller, bot, message);
        }
    );
}

async function getUserAsync(controller, id) {
    try {
        return await Promise.promisify(
            controller.storage.users.get.bind(controller.storage.users)
        )(id);
    } catch (err) {}
    return null;
}

async function saveUserAsync(controller, user) {
    return Promise.promisify(
        controller.storage.users.save.bind(controller.storage.users)
    )(user);
}

async function deleteUserAsync(controller, id) {
    return Promise.promisify(
        controller.storage.users.delete.bind(controller.storage.users)
    )(id);
}

async function saveUserTempDataAsync(controller, id, data) {
    let user = await getUserAsync(controller, id);
    if (!user) {
        user = {id};
    }

    user = {...user, tempdata: {...user.tempdata, ...data}};

    await saveUserAsync(controller, user);
}

async function getUserTempDataAsync(controller, id) {
    const user = await getUserAsync(controller, id);
    const {tempdata = null} = (user || {});

    return tempdata;
}

async function deleteUserTempDataAsync(controller, id) {
    let user = await getUserAsync(controller, id);
    const {tempdata = null, ...restUser} = user;
    user = {...restUser, id};

    await saveUserAsync(controller, user);
}

async function startConvo(bot, message) {
    return Promise.promisify(bot.startConversation.bind(bot))(message);
}

function checkForAbortRequest(text) {
    const t = text.trim().toLowerCase();
    return t === 'quit' || t === 'abort';
}

async function convoAskForValue(convo, question,
    transform = (v) => v, validate = () => true) {
    return new Promise((resolve, _) => {
        convo.ask(question, (response, convo) => {
            if (checkForAbortRequest(response.text)) {
                convo.stop();
                return;
            }
            const v = transform(response.text);
            if (validate(v)) {
                resolve(v);
            } else {
                convo.repeat();
            }
            convo.next();
        }, {});
    });
}

function extractLink(text) {
    // https://api.slack.com/docs/formatting
    // Based on https://raw.githubusercontent.com/slackapi/hubot-slack/ea562aeadab3f9f58e8db6ee5e86a4a41509db6a/src/slack.coffee
    text = text.replace(/<([@#!])?([^>|]+)(?:\|([^>]+))?>/g, (m, type, link, label) => {
        if (type !== '@' || type !== '#' || type !== '!') {
            link = link.replace(/^mailto:/, '')
            return link
        } else {
            ''
        }
    })
    text = text.replace(/&lt;/g, '<')
    text = text.replace(/&gt;/g, '>')
    text = text.replace(/&amp;/g, '&')
    return text
}

const defaultPatternOpts = (bot) => [
    {
        pattern: bot.utterances.yes,
        answer: true,
    },
    {
        pattern: bot.utterances.no,
        answer: false,
    },
];

async function convoAskForPattern(convo, question, options) {
    return new Promise((resolve, _) => {
        let opts = {};

        let defaultCallback = (response, convo) => {
            if (checkForAbortRequest(response.text)) {
                convo.stop();
                return;
            }
            convo.repeat();
            convo.next();
        };

        let wrappedResponse = (answer, convo) => {
            resolve(answer);
            convo.next();
        };

        const callbacks = [
            ...options.map(
                ({pattern, answer}) => ({
                    pattern,
                    callback: (_, convo) => wrappedResponse(answer, convo)
                })
            ),
            {
                default: true,
                callback: defaultCallback,
            },
        ];

        convo.ask(question, callbacks, opts);
    });
}

async function handleErase(controller, bot, message) {
    let user = await getUserAsync(controller, message.user);
    if (!user) {
        bot.reply(message, `I don't know you. Who do you think you are?`);
        return;
    }

    const convo = await startConvo(bot, message);
    convo.on('end', (convo) => {
        if (convo.status !== 'completed') {
            bot.reply(message, 'Aborting!');
        }
    });

    const confirmed = await convoAskForPattern(
        convo,
        `I'll erase my dossier on you. Sure about that?`,
        defaultPatternOpts(bot)
    );

    if (!confirmed) {
        convo.say(`That's what I thought. Wise choice`);
        return;
    }

    convo.say(`As you wish...`);

    await deleteUserAsync(controller, message.user);

    convo.say(`You're gone. Poof!`);

    convo.next();
}

function listenForGithubRegister(controller) {
    controller.hears(['github'], 'direct_message,direct_mention,mention', function(bot, message) {
        handleGithubRegister(controller, bot, message);
    });
}

async function waitForGithubAccessToken() {
    return new Promise((resolve, reject) => {
        let successHandler = null;
        let errorHandler = null;
        let unsubscribed = false;
        let unsubscribe = () => {
            if (!unsubscribed) {
                unsubscribed = true;
                githubAuthEvent.off('success', successHandler);
                githubAuthEvent.off('error', errorHandler);
            }
        };
        successHandler = (access_token) => {
            console.log('success', access_token);
            unsubscribe();
            resolve(access_token);
        };
        errorHandler = (err) => {
            console.error('err');
            unsubscribe();
            reject(err);
        };
        githubAuthEvent.on('success', successHandler);
        githubAuthEvent.on('error', errorHandler);
        setTimeout(() => {
            unsubscribe();
            reject(new Promise.TimeoutError());
        }, 120 * 1000);
    });
}

async function handleGithubRegister(controller, bot, message) {
    const convo = await startConvo(bot, message);
    convo.on('end', (convo) => {
        if (convo.status === 'completed') {
            // bot.reply(message, 'Done!')
        } else {
            bot.reply(message, 'Aborting!');
        }
    });

    const url = await convoAskForValue(
        convo,
        `What's your github repo url for #100daysofcode?`,
    );

    const callbackUrl = `${SlackConfig.base_url}/callbacks/github`;

    let secret = '';
    try {
        secret = await Promise.promisify(tokens.secret.bind(tokens))();
    } catch (err) {
        console.log(err);
        throw err;
    }

    const state = tokens.create(secret);

    const authLink = `https://github.com/login/oauth/authorize?client_id=${SlackConfig.client_id}&scope=public_repo&redirect_uri=${callbackUrl}&state=${state}`;

    convo.say(`\<${authLink}|Authorize me>. You have 120 seconds. Go!`);

    let accessToken = null;
    try {
        accessToken = await waitForGithubAccessToken();
    } catch (err) {
        console.error(err);
        convo.say('Tough luck. If only you could follow a simple instruction. Try again later.');
        convo.next();
    }

    await saveUserTempDataAsync(controller, message.user,
        {accessToken, github_repo_url: url});

    convo.say(`Great. Let me check of what you've been doing so far.`);
}

async function handleGithubCallback(req, res) {
    const {code, state} = req.query;

    // TODO: verify csrf token
    const response = await axios.post('https://github.com/login/oauth/access_token', {
        client_id: SlackConfig.client_id,
        client_secret: SlackConfig.client_secret,
        code,
        state,
    });

    const {access_token} = qs.parse(response.data);

    console.log(access_token);

    githubAuthEvent.emit('success', access_token);

    res.send('Authorization successful. You may close this tab.');
}


function listenForRegister(controller) {
    controller.hears(['register', 'setup'], 'direct_message', function(bot, message) {
        handleRegister(controller, bot, message);
    });
}

async function handleRegister(controller, bot, message) {
    let convo = await startConvo(bot, message);
    convo.on('end', (convo) => {
        if (convo.status === 'completed') {
            // bot.reply(message, `Done!`);

            // user = {
            //     id: message.user,
            //     // name : convo.extractResponse('name'),
            //     // startdate : convo.extractResponse('start_date'),
            //     // missed_dates : convo.extractResponse('missed_dates'),
            //     // github_repo_url : convo.extractResponse('github_repo_url'),
            // };
            // console.log(JSON.stringify(user));
            // // controller.storage.users.save(user, function(err, id) {
            // setTimeout(() => {
            //     bot.reply(message, `Done! Welcome ${user.name} :wave:!`);
            // }, 1000);
            // });
        } else {
            bot.reply(message, 'Aborting!');
        }
    });

    const tempdata = await getUserTempDataAsync(controller, message.user);

    let newSession = true;

    let name = undefined;
    let start_date = undefined; 
    let missed_dates = undefined; 
    let github_repo = undefined;
    if (tempdata) {
        const choice = await convoAskForPattern(
            convo,
            'Shall we - A) pick up where we left off? OR B) start with a blank slate?',
            [
                {
                    pattern: /^[aA]$/,
                    answer: 'a',
                },
                {
                    pattern: /^[bB]$/,
                    answer: 'b',
                },
            ]
        );
        if (choice === 'a') {
            name = tempdata.name;
            start_date = tempdata.start_date;
            missed_dates = tempdata.missed_dates;
            github_repo = tempdata.github_repo;

            newSession = false;

            convo.say('Alright, so where were we?');
        } else if (choice === 'b') {
            await deleteUserTempDataAsync(controller, message.user);
            convo.say('Blank slate it is!');
        } else {
            convo.say(`No time for this nonsense. Come back when you're not stupid.`);
            convo.next();
            return;
        }
    }

    if (newSession) {
        convo.say('Alright! let\'s get you all squanched up!');
    }

    if (!name) {
        name = await convoAskForValue(convo, 'What do I call you?');

        await saveUserTempDataAsync(controller, message.user, {name});

        convo.say(`Will call you ${name}`);
    }

    if (!start_date) {
        start_date = await convoAskForValue(
            convo,
            'When did you start the challenge?',
            (date) => chrono.parseDate(date),
        );

        await saveUserTempDataAsync(controller, message.user, {start_date});
    }

    if (missed_dates === undefined) {
        const didMissDays = await convoAskForPattern(
            convo,
            'Did you miss any days?',
            defaultPatternOpts(bot)
        );

        if (didMissDays) {
            let retries = 2;
            let success = false;
            while (retries > 0) {
                missed_dates = await convoAskForValue(
                    convo,
                    'Which days did you miss?',
                    (text) => text.split(',').map((t) => chrono.parseDate(t)).filter((v) => v),
                    (dates) => dates.length > 0,
                );

                const missed_dates_str = missed_dates.map((v) => moment(v).format('ll')).join(', ');

                const affirmative = await convoAskForPattern(
                    convo,
                    `Just to confirm, are these the days you missed? - ${missed_dates_str}`,
                    defaultPatternOpts(bot)
                );

                if (affirmative) {
                    await saveUserTempDataAsync(controller, message.user, {missed_dates});
                    success = true;
                    break;
                }
                retries--;
            }

            if (!success) {
                convo.say(`I'm going to assume you have nothing useful to say. Moving on.`);
            }
        }
    }

    if (!github_repo) {

        const callbackUrl = `${SlackConfig.base_url}/callbacks/github`;

        let secret = '';
        try {
            secret = await Promise.promisify(tokens.secret.bind(tokens))();
        } catch (err) {
            console.log(err);
            throw err;
        }

        const state = tokens.create(secret);

        const authLink = `https://github.com/login/oauth/authorize?client_id=${SlackConfig.client_id}&scope=public_repo&redirect_uri=${callbackUrl}&state=${state}`;

        convo.say(`\<${authLink}|Authorize me>. You have 120 seconds. Go!`);

        let access_token = null;
        try {
            access_token = await waitForGithubAccessToken();
        } catch (err) {
            console.error(err);
            convo.say('Tough luck. If only you could follow a simple instruction. Try again later.');
            convo.next();
        }

        await saveUserTempDataAsync(controller, message.user,
            { access_token });

        octokit.authenticate({
            type: 'oauth',
            token: access_token
        })

        const result = await octokit.repos.getAll({
            type : 'owner', per_page : 100
        })

        const repos = result.data.map(({ id, full_name, name, owner : { login } }) => ({ id, full_name, repo : name, owner : login }))

        // console.log(repos);

        const repo = repos.find(r => /(100).*(days)/g.test(r.full_name))

        convo = await startConvo(bot, message);

        if (repo) {
            const affirmative = await convoAskForPattern(
                convo,
                `Is this the repo? - ${repo.full_name}`,
                defaultPatternOpts(bot)
            )
            if (affirmative) {
                github_repo = repo
            }
        }

        if (!github_repo) {
            convo.say(`Grr. I can't find your repo.`)
            return
        }
    
        await saveUserTempDataAsync(controller, message.user,
            { github_repo });

        
        // const repos_list_str = repos.map((r, i) => `[${i+1}] ${r.full_name}`).join('\n')

        // const repoId = await convoAskForPattern(
        //     convo,
        //     "Which is the 100 days of code repo?" + '\n' + repos_list_str,
        //     repos.map((r, i) => {
        //         return {
        //             pattern : new RegExp(`/^${i+1}$/`,"g"),
        //             answer : r.id
        //         }
        //     })
        // )

        // console.log(repoId);

        // let resText = await convoAskForValue(
        //     convo,
        //     `What's your github repo url for #100daysofcode?`,
        // );

        // github_url = extractLink(resText)

        // if (!github_url) {
        //     convo.say(`That's not a link. You think I'm stupid?`);
        //     return
        // }

        // if (!/^(http|https):\/\/github.com/.test(github_url)) {
        //     convo.say(`That's not a github repository. You think I'm stupid?`);
        //     return
        // }

        // if (!validatedRepo) {
        //     convo.say(`I need a repo to work with. Don't you get it?`);
        //     return;
        // }
    }
}

function listenForWhoami(controller) {
    controller.hears(['what is my name', 'who am i', 'whoami'], 'direct_message,direct_mention,mention', function(bot, message) {
        controller.storage.users.get(message.user, function(err, user) {
            if (user) {
                bot.reply(message, `Your name is ${user.name}. You started on is ${user.startdate}`);
            } else {
                bot.reply(message, `Why would I know who you are? Register yourself first.`);
            }
        });
    });
}

function listenFoEverythingElse(controller) {
    controller.hears([/.*/], 'direct_message,direct_mention', function(bot, message) {
        bot.reply(message, `Wubba lubba dub dub. That makes just as much sense. Get your verbs together.`);
    });
}

function init(controller) {
    listenForRegister(controller);
    listenForErase(controller);
    listenForWhoami(controller);
    listenForTest(controller);
    listenForGithubRegister(controller);
    listenFoEverythingElse(controller);
}

module.exports = {
    init,
    handleGithubCallback,
};
