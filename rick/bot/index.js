const chrono = require('chrono-node')
const Moment = require('moment');
const MomentRange = require('moment-range');

const moment = MomentRange.extendMoment(Moment);

function listenForErase(controller) {
    controller.hears(['erase'], 'direct_message,direct_mention,mention', function(bot, message) {
        bot.startConversation(message, function(err, convo) {
            if (!err) {
                controller.storage.users.get(message.user, (err, user) => {
                    if (err) {
                        convo.say(`Dude, I don't even know you`)
                        return convo.next()
                    }

                    convo.ask("I'll erase my dossier on you. Sure about that?", [
                        {
                            pattern: bot.utterances.yes,
                            callback: function(response, convo) {
                                convo.say(`As you wish...`);

                                controller.storage.users.delete(message.user, function(err) {
                                    convo.say(`You're gone. Poof!`)
                                    convo.next();
                                })
                            }
                        },
                        {
                            pattern: bot.utterances.no,
                            callback: function(response, convo) {
                                // stop the conversation. this will cause it to end with status == 'stopped'
                                convo.say(`That's what I thought. Wise choice`);
                                convo.stop();
                            }
                        },
                        {
                            default: true,
                            callback: function(response, convo) {
                                convo.repeat();
                                convo.next();
                            }
                        }
                    ])
                })
            }
        })
    })
}

function* register(controller, bot, message, resume) {
    console.log('here');
    const { err, user } = yield controller.storage.users.get(message.user, resume)
    console.log('here 1');
    if (err) {
        user = null
    }
    if (user) {
        bot.reply('You have registered already!')
        return
    }
    console.log('here 2');
    let cr = null
    cr = yield bot.startConversation(message, resume)
    console.log(cr);
    console.log('here 3');
    cr.convo.say(`Alright! Let's get you all squanched up!`)

    cr = yield cr.convo.ask(`When did you start the challenge?`, resume, {'key': 'startdate'})
    const startDate = chrono.parseDate(cr.response.text)

    cr.convo.say(`(Response : ${startDate})`)
    if (startDate) {
        // askIfMissedDays(response, convo)
        cr.convo.next()
    } else {
        cr.convo.repeat()
    }
}

function runRegister(controller, bot, message) {
    let end = false
    const resume = (...args) => {
        if (end) {
            return
        }
        const result = { ...args }
        const { done } = gen_register.next(result)
        end = done
    }
    const gen_register = register(controller, bot, message, resume)
    resume(null)
}

function askGithubRepoUrl(response, convo) {
    convo.ask(`What's your github repo url for #100daysofcode?`, function(response, convo) {
        convo.say(`(${response.text})`)
        convo.next()
    }, { key : 'github_repo_url' })
}

function askDatesMissed(response, convo) {
    convo.ask(`Which dates did you miss?`, function(response, convo) {
        const dates = chrono.parseDate(response.text)
        convo.say(`(${dates})`)
        console.log(JSON.stringify(chrono.parse(response.text)));
        askGithubRepoUrl(response, convo)
        convo.next()
    }, { key : 'missed_dates' })
}

function askIfMissedDays(response, convo) {
    convo.ask(`Did you miss any days?`, [
        {
            pattern: bot.utterances.yes,
            callback: (response, convo) => {
                askDatesMissed(response, convo)
                convo.next()
            },
        },
        {
            pattern: bot.utterances.no,
            callback: (response, convo) => {
                askGithubRepoUrl(response, convo)
                convo.next()
            }
        },
        {
            default: true,
            callback: function(response, convo) {
                convo.repeat();
                convo.next();
            }
        }
    ], { key : 'has_missed_dates' })
}

function askStartDate(response, convo) {
    convo.ask(`When did you start the challenge?`, function(response, convo) {
        const startDate = chrono.parseDate(response.text)

        convo.say(`(Response : ${startDate})`)
        if (startDate) {
            askIfMissedDays(response, convo)
            convo.next()
        } else {
            convo.repeat()
        }
    }, {'key': 'startdate'});
}

function askNickname(response, convo) {
    convo.ask(`What do I call you?`, function(response, convo) {
        convo.say(`(Response : ${response.text})`)
        // convo.sayFirst(`OK! I'll call you ${response.text} from now on`)
        askStartDate(response, convo);
        convo.next();
    }, {'key': 'nickname'});
}

function listenForRegister(controller) {
    controller.hears(['register', 'setup'], 'direct_message', function(bot, message) {
        runRegister(controller, bot, message)
        // controller.storage.users.get(message.user, function(err, user) {
        //     if (err) {
        //         user = null
        //     }
        //     if (user) {
        //         bot.reply('You have registered already!')
        //         return
        //     } else {
        //         bot.startConversation(message, function(err, convo) {
        //             if (err) {
        //                 return
        //             }
        //             convo.say(`Alright! Let's get you all squanched up!`)
        //             askStartDate(null, convo)
        //
        //             convo.on('end', convo => {
        //                 if (convo.status === 'completed') {
        //                     bot.reply(message, 'All set! Creating a dossier on you...hang tight');
        //
        //                     user = {
        //                         id: message.user,
        //                         name : convo.extractResponse('nickname'),
        //                         startdate : convo.extractResponse('startdate')
        //                     }
        //                     // controller.storage.users.save(user, function(err, id) {
        //                         setTimeout(() => {
        //                             bot.reply(message, `Done! Welcome ${user.name} :wave:!`);
        //                         }, 1000)
        //                     // });
        //                 }
        //             })
        //         })
        //     }
        // })
    })
}

function listenForWhoami(controller) {
    controller.hears(['what is my name', 'who am i', 'whoami'], 'direct_message,direct_mention,mention', function(bot, message) {
        controller.storage.users.get(message.user, function(err, user) {
            if (user) {
                bot.reply(message, `Your name is ${user.name}. You started on is ${user.startdate}`);
            } else {
                bot.reply(message, `Why would I know who you are? Register yourself first.`);
            }
        })
    })
}

function init(controller) {
    listenForRegister(controller)
    listenForErase(controller)
    listenForWhoami(controller)
}

module.exports = {
    init
}
