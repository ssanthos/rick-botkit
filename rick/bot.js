/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
           ______     ______     ______   __  __     __     ______
          /\  == \   /\  __ \   /\__  _\ /\ \/ /    /\ \   /\__  _\
          \ \  __<   \ \ \/\ \  \/_/\ \/ \ \  _"-.  \ \ \  \/_/\ \/
           \ \_____\  \ \_____\    \ \_\  \ \_\ \_\  \ \_\    \ \_\
            \/_____/   \/_____/     \/_/   \/_/\/_/   \/_/     \/_/


This is a sample Slack bot built with Botkit.

This bot demonstrates many of the core features of Botkit:

* Connect to Slack using the real time API
* Receive messages based on "spoken" patterns
* Reply to messages
* Use the conversation system to ask questions
* Use the built in storage system to store and retrieve information
  for a user.

# RUN THE BOT:

  Create a new app via the Slack Developer site:

    -> http://api.slack.com

  Get a Botkit Studio token from Botkit.ai:

    -> https://studio.botkit.ai/

  Run your bot from the command line:

    clientId=<MY SLACK TOKEN> clientSecret=<my client secret> PORT=<3000> studio_token=<MY BOTKIT STUDIO TOKEN> node bot.js

# USE THE BOT:

    Navigate to the built-in login page:

    https://<myhost.com>/login

    This will authenticate you with Slack.

    If successful, your bot will come online and greet you.


# EXTEND THE BOT:

  Botkit has many features for building cool and useful bots!

  Read all about it here:

    -> http://howdy.ai/botkit

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/
var env = require('node-env-file');
env(__dirname + '/.env');


if (!process.env.clientId || !process.env.clientSecret || !process.env.PORT) {
  usage_tip();
  // process.exit(1);
}

var Botkit = require('botkit');
var debug = require('debug')('botkit:main');

var bot_options = {
    clientId: process.env.clientId,
    clientSecret: process.env.clientSecret,
    // debug: true,
    scopes: ['bot'],
    studio_token: process.env.studio_token,
    studio_command_uri: process.env.studio_command_uri
};

// Use a mongo database if specified, otherwise store in a JSON file local to the app.
// Mongo is automatically configured when deploying to Heroku
if (process.env.MONGO_URI) {
    var mongoStorage = require('botkit-storage-mongo')({mongoUri: process.env.MONGO_URI});
    bot_options.storage = mongoStorage;
} else {
    bot_options.json_file_store = __dirname + '/.data/db/'; // store user data in a simple JSON format
}

// Create the Botkit controller, which controls all instances of the bot.
var controller = Botkit.slackbot(bot_options);

controller.startTicking();

// Set up an Express-powered webserver to expose oauth and webhook endpoints
var webserver = require(__dirname + '/components/express_webserver.js')(controller);

if (!process.env.clientId || !process.env.clientSecret) {

  // Load in some helpers that make running Botkit on Glitch.com better
  require(__dirname + '/components/plugin_glitch.js')(controller);

  webserver.get('/', function(req, res){
    res.render('installation', {
      studio_enabled: controller.config.studio_token ? true : false,
      domain: req.get('host'),
      protocol: req.protocol,
      glitch_domain:  process.env.PROJECT_DOMAIN,
      layout: 'layouts/default'
    });
  })

  var where_its_at = 'https://' + process.env.PROJECT_DOMAIN + '.glitch.me/';
  console.log('WARNING: This application is not fully configured to work with Slack. Please see instructions at ' + where_its_at);
}else {

  webserver.get('/', function(req, res){
    res.render('index', {
      domain: req.get('host'),
      protocol: req.protocol,
      glitch_domain:  process.env.PROJECT_DOMAIN,
      layout: 'layouts/default'
    });
  })
  // Set up a simple storage backend for keeping a record of customers
  // who sign up for the app via the oauth
  require(__dirname + '/components/user_registration.js')(controller);

  // Send an onboarding message when a new team joins
  require(__dirname + '/components/onboarding.js')(controller);

  // Load in some helpers that make running Botkit on Glitch.com better
  require(__dirname + '/components/plugin_glitch.js')(controller);

  // enable advanced botkit studio metrics
  require('botkit-studio-metrics')(controller);

  var normalizedPath = require("path").join(__dirname, "skills");
  require("fs").readdirSync(normalizedPath).forEach(function(file) {
    require("./skills/" + file)(controller);
  });

  // This captures and evaluates any message sent to the bot as a DM
  // or sent to the bot in the form "@bot message" and passes it to
  // Botkit Studio to evaluate for trigger words and patterns.
  // If a trigger is matched, the conversation will automatically fire!
  // You can tie into the execution of the script using the functions
  // controller.studio.before, controller.studio.after and controller.studio.validate
  if (process.env.studio_token) {
      controller.on('direct_message,direct_mention,mention', function(bot, message) {
          controller.studio.runTrigger(bot, message.text, message.user, message.channel, message).then(function(convo) {
              if (!convo) {
                  // no trigger was matched
                  // If you want your bot to respond to every message,
                  // define a 'fallback' script in Botkit Studio
                  // and uncomment the line below.
                  // controller.studio.run(bot, 'fallback', message.user, message.channel);
              } else {
                  // set variables here that are needed for EVERY script
                  // use controller.studio.before('script') to set variables specific to a script
                  convo.setVar('current_time', new Date());
              }
          }).catch(function(err) {
              bot.reply(message, 'I experienced an error with a request to Botkit Studio: ' + err);
              debug('Botkit Studio: ', err);
          });
      });
  } else {
      console.log('~~~~~~~~~~');
      console.log('NOTE: Botkit Studio functionality has not been enabled');
      console.log('To enable, pass in a studio_token parameter with a token from https://studio.botkit.ai/');
  }

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

  controller.hears(['register', 'setup'], 'direct_message', function(bot, message) {
      controller.storage.users.get(message.user, function(err, user) {
          if (err) {
              user = null
          }
          if (user) {
              bot.reply('You have registered already!')
              return
          } else {
              bot.startConversation(message, function(err, convo) {
                  if (err) {
                      return
                  }
                  convo.say(`Alright! Let's get you all squanched up!`)
                  convo.ask(`What do I call you?`, (response, convo) => {
                      convo.sayFirst(`OK! I'll call you ${response.text} from now on`)

                      convo.ask(`What is your favorite color?`, (response, convo) => {
                          convo.sayFirst(`OK! I'll set the color as ${response.text} from now on`)
                          convo.next()
                      }, {'key': 'color'})

                      convo.next()
                  }, {'key': 'nickname'})



                  convo.on('end', convo => {
                      if (convo.status === 'completed') {
                        bot.reply(message, 'OK! Creating a dossier on you...hang tight');

                        user = {
                            id: message.user,
                            name : convo.extractResponse('nickname'),
                            color : convo.extractResponse('color')
                        }
                        controller.storage.users.save(user, function(err, id) {
                            setTimeout(() => {
                                bot.reply(message, `All done, ${user.name}! Welcome, and see you around!`);
                            }, 1000)
                        });
                      }
                  })
              })
          }
      })
  })

  controller.hears(['what is my name', 'who am i'], 'direct_message,direct_mention,mention', function(bot, message) {

      controller.storage.users.get(message.user, function(err, user) {
          if (user && user.name) {
              bot.reply(message, `Your name is ${user.name}. Your favorite color is ${user.color}`);
          } else {
              bot.startConversation(message, function(err, convo) {
                  if (!err) {
                      convo.say('I do not know your name yet!');
                      convo.ask('What should I call you?', function(response, convo) {
                          convo.ask('You want me to call you `' + response.text + '`?', [
                              {
                                  pattern: 'yes',
                                  callback: function(response, convo) {
                                      // since no further messages are queued after this,
                                      // the conversation will end naturally with status == 'completed'
                                      convo.next();
                                  }
                              },
                              {
                                  pattern: 'no',
                                  callback: function(response, convo) {
                                      // stop the conversation. this will cause it to end with status == 'stopped'
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
                          ]);

                          convo.next();

                      }, {'key': 'nickname'}); // store the results in a field called nickname

                      convo.on('end', function(convo) {
                          if (convo.status == 'completed') {
                              bot.reply(message, 'OK! I will update my dossier...');

                              controller.storage.users.get(message.user, function(err, user) {
                                  if (!user) {
                                      user = {
                                          id: message.user,
                                      };
                                  }
                                  user.name = convo.extractResponse('nickname');
                                  controller.storage.users.save(user, function(err, id) {
                                      bot.reply(message, 'Got it. I will call you ' + user.name + ' from now on.');
                                  });
                              });



                          } else {
                              // this happens if the conversation ended prematurely for some reason
                              bot.reply(message, 'OK, nevermind!');
                          }
                      });
                  }
              });
          }
      });
  });
}





function usage_tip() {
    console.log('~~~~~~~~~~');
    console.log('Botkit Starter Kit');
    console.log('Execute your bot application like this:');
    console.log('clientId=<MY SLACK CLIENT ID> clientSecret=<MY CLIENT SECRET> PORT=3000 studio_token=<MY BOTKIT STUDIO TOKEN> node bot.js');
    console.log('Get Slack app credentials here: https://api.slack.com/apps')
    console.log('Get a Botkit Studio token here: https://studio.botkit.ai/')
    console.log('~~~~~~~~~~');
}
