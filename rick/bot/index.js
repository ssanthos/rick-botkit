const chrono = require('chrono-node')

function listenForTest(controller) {
    controller.hears(['test'], 'direct_message,direct_mention,mention', function(bot, message) {
        const user = {
            id : message.user,
            name : 'testname'
        }
        controller.storage.users.save(user, (err) => {
            bot.reply(message, err ? 'Something went wrong' : 'Done!')
        })
    })
}

function listenForErase(controller) {
    controller.hears(['erase'], 'direct_message,direct_mention,mention', function(bot, message) {
        runErase(controller, bot, message)
    })
}

function listenForGithubRegister(controller) {
    controller.hears(['github'], 'direct_message,direct_mention,mention', function(bot, message) {
        runGithubRegister(controller, bot, message)
    })
}

function* registerSequence() {
    yield { say : "Alright! let's get you all squanched up!" }
    const name = yield { ask : "What do I call you?", key : 'name' }
    yield { say : `Will call you ${name}` }
    
    yield { 
        ask : "When did you start the challenge?",
        validate : date => chrono.parseDate(date),
        key : 'start_date',
    }
    
    const didMissDays = yield {
        ask : "Did you miss any days?",
        options : [
            {
                pattern : bot.utterances.yes,
                answer : true
            },
            {
                pattern : bot.utterances.no,
                answer : false
            },
        ]
    }
    
    if (didMissDays) {
        yield {
            ask : "Which days did you miss?",
            validate : text => true,
            key : 'missed_dates'
        }
    }
    
    yield {
        ask : `What's your github repo url for #100daysofcode?`,
        key : 'github_repo_url'
    }
}

function setupSequence(gen, controller, bot, message) {
    const gen_register = gen()
    const resume = (response, convo) => {
        if (response && response.text === 'abort') {
            return convo.stop()
        }
        const err = response instanceof Error ? response : null
        const { done, value } = err ? gen_register.throw(err) : gen_register.next((response || {}).text)
        if (done) {
            return convo.next()
        }
        const { 
            say = null, ask = null, validate = () => true, key = null 
        } = value
        let { options = [] } = value
        const { operation = null, timeout = 0 } = value
        if (operation) {
            if (operation === 'delay') {
                setTimeout(() => {
                    return resume(null, convo)
                }, timeout)
            }
            if (operation === 'get_user') {
                controller.storage.users.get(message.user, (err, user) => {
                    if (err) {
                        return resume(err, convo)
                    } else {
                        return resume({ text : user }, convo)
                    }
                })
                
            } else if (operation === 'delete_user') {
                controller.storage.users.delete(message.user, (err, user) => {
                    if (err) {
                        return resume(err, convo)
                    } else {
                        return resume(null, convo)
                    }
                })
            }
        }
        if (say) {
            convo.say(say)
            return resume(null, convo)
        } else if (ask) {
            let opts = {}
            if (key) {
                opts = { ...opts, key }
            }
            if (options && options.length > 0) {
                let defaultCallback = (response, convo) => {
                    convo.repeat()
                    convo.next()
                }
                const wrappedResume = (answer, convo) => {
                    resume({ text : answer }, convo)
                    convo.next()
                }

                const callbacks = [ 
                    ...options.map(({ pattern, answer }) => ({ pattern, callback : (_, convo) => wrappedResume(answer, convo) })), 
                    {
                        default: true,
                        callback : defaultCallback
                    }
                ]
                convo.ask(ask, callbacks, opts)
            } else {
                const wrappedResume = (response, convo) => {
                    if (validate(response.text)) {
                        resume(response, convo)
                    } else {
                        convo.repeat()
                    }
                    convo.next()
                }
                convo.ask(ask, wrappedResume, opts)
            }
            
            convo.next()
        }
    }
    return { resume }
}

function runRegister(controller, bot, message) {
    const { resume } = setupSequence(registerSequence, controller, bot, message)

    bot.startConversation(message, (err, convo) => {
        convo.on('end', convo => {
            if (convo.status === 'completed') {
                bot.reply(message, 'All set! Creating a dossier on you...hang tight');
                
                user = {
                    id: message.user,
                    name : convo.extractResponse('name'),
                    startdate : convo.extractResponse('start_date'),
                    missed_dates : convo.extractResponse('missed_dates'),
                    github_repo_url : convo.extractResponse('github_repo_url'),
                }
                console.log(JSON.stringify(user))
                // controller.storage.users.save(user, function(err, id) {
                setTimeout(() => {
                    bot.reply(message, `Done! Welcome ${user.name} :wave:!`);
                }, 1000)
                // });
            } else {
                bot.reply(message, 'Aborting!')
            }
        })
        return resume(null, convo)
    })
}

function* eraseSequence() {
    try {
        const user = yield { operation : 'get_user' }
        
        const confirmed = yield {
            ask : "I'll erase my dossier on you. Sure about that?",
            options : [
                {
                    pattern : bot.utterances.yes,
                    answer : true
                },
                {
                    pattern : bot.utterances.no,
                    answer : false
                },
            ]
        }

        if (!confirmed) {
            yield { say : `That's what I thought. Wise choice` }
            return
        }

        yield { say : `As you wish...` }

        yield { operation : 'delete_user' }

        yield { say : `You're gone. Poof!` }

        return
    } catch (err) {
        
    }
    yield { say : `Dude, I don't even know you` }
    yield { operation : 'delay', timeout : 1000 }
    
}

function runErase(controller, bot, message) {
    const { resume } = setupSequence(eraseSequence, controller, bot, message)
    
    bot.startConversation(message, (err, convo) => {
        convo.on('end', convo => {
            if (convo.status !== 'completed') {
                bot.reply(message, 'Aborting!')
            }
        })
        return resume(null, convo)
    })
}

function* githubRegisterSequence(controller, bot, message) {
    // const url = yield {
    //     ask : `What's your github repo url for #100daysofcode?`,
    //     key : 'github_repo_url'
    // }
    yield {
        say : 'Open https://github.com/login/oauth/authorize to authorize me'
    }
}

function runGithubRegister(controller, bot, message) {
    const { resume } = setupSequence(githubRegisterSequence, controller, bot, message)
    
    bot.startConversation(message, (err, convo) => {
        convo.on('end', convo => {
            if (convo.status === 'completed') {
                bot.reply(message, 'Done!')
            } else {
                bot.reply(message, 'Aborting!')
            }
        })
        return resume(null, convo)
    })
}

function listenForRegister(controller) {
    controller.hears(['register', 'setup'], 'direct_message', function(bot, message) {
        runRegister(controller, bot, message)
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
    listenForTest(controller)
    listenForGithubRegister(controller)
}

module.exports = {
    init
}
