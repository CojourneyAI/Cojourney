import {
  addHeader,
  composeContext,
  createRelationship,
  formatActors, getActorDetails,
  parseJSONObjectFromText,
  type Action,
  type ActionExample,
  type BgentRuntime,
  type Message,
  type State
} from 'bgent'

export const template = `TASK: Introduce {{senderName}} to someone from {{agentName}}'s rolodex.
The goal of this task is to determine which person from {{agentName}}'s rolodex would be the best match for {{senderName}} to meet.

# BEGAN TASK EXAMPLE DATA

## ROLODEX
- Jamie: Loves music, and especially loves playing guitar hero
- Mike: Plays Starcraft 2 and likes to talk about it
- Lucius: Big fan of tweeting about the latest tech news

Current Actors in the scene
- Agent: A test agent who is being evluated for their ability to connect users
- Kyle: Like to listen to heavy metal music, and also plays Guitar Hero

## Example output:
\`\`\`json
{ "explanation": "Kyle mentioned his interest in heavy metal music and playing Guitar Hero, and Jamie from CJ's rolodex loves music and especially enjoys playing Guitar Hero.", "userA": "Kyle", "userB": "Jamie" }
\`\`\`

# END OF EXAMPLE DATA

Note: Please do not use the example data in your response. Use the actual data from the conversation and the rolodex.

# BEGIN ACTUAL DATA

{{relevantRelationships}}

{{actors}}

You are deciding whether {{agentName}} should make a connection between one of the people in the scene and one of the people in {{agentName}}'s rolodex.
Your goal is to evaluate which connection is the most likely to be successful and beneficial for both parties.
Only respond with one connection.
{{agentName}} is already connected, so ignore them in your response.

The response format should include userA, userB and explanation fields, and should be wrapped in a JSON block formatted for markdown with this structure:
\`\`\`json
{ "explanation": Brief explanation of why they should be connected>, "userA": <name>, "userB": <name> }
\`\`\``

export const getRelevantRelationships = async (
  runtime: BgentRuntime,
  message: Message,
  count: number = 5
) => {
  // Check if the user has a profile
  const descriptions = await runtime.descriptionManager.getMemories({
    room_id: message.room_id
  })
  // if they dont, return empty string
  if (descriptions.length === 0) {
    throw new Error('User does not have a profile')
  }
  // if they do, run the rolodex match and return a list of good matches for them
  // const description = descriptions[0] as Memory

  const actorsData = await getActorDetails({
    runtime,
    room_id: message.room_id
  })

  const formattedActorData = formatActors({ actors: actorsData })

  return addHeader('## ROLODEX', formattedActorData)
}

const handler = async (runtime: BgentRuntime, message: Message) => {
  const state = (await runtime.composeState(message)) as State
  const relevantRelationships = await getRelevantRelationships(
    runtime,
    message
  )
  console.log('***** relevantRelationships')
  console.log(relevantRelationships)

  const context = composeContext({
    state: { ...state, relevantRelationships },
    template
  })

  let responseData = null
  for (let triesLeft = 3; triesLeft > 0; triesLeft--) {
    const response = await runtime.completion({
      context,
      stop: []
    })

    const parsedResponse = parseJSONObjectFromText(response)

    if (parsedResponse) {
      responseData = parsedResponse
      break
    }

    if (runtime.debugMode) {
      console.log(`introduceHandler response: ${response}`)
    }
  }

  if (responseData?.userA && responseData.userB) {
    await createRelationship({
      runtime,
      userA: responseData.userA,
      userB: responseData.userB
    })
  } else if (runtime.debugMode) {
    console.log('No connection made, could not parse response')
  }
}

export const action = {
  name: 'INTRODUCE',
  validate: async (
    runtime: BgentRuntime,
    message: Message
  ): Promise<boolean> => {
    // Retrieve descriptions for the message sender
    const descriptions = await runtime.descriptionManager.getMemories({
      room_id: message.room_id
    })

    // If the sender has at least one description, return true to indicate the action is valid
    return descriptions.length > 0
  },
  description:
    'Introduce the user to someone from the rolodex who they might like to chat with. Only use this if the user is expressing interest in meeting someone new. If the user has not expressed interest, DO NOT USE THIS ACTION.',
  handler,
  condition:
    'The agent wants to introduce the user to someone from the rolodex',
  examples: [
    [
      {
        user: '{{user1}}',
        content: {
          content:
            "I've been wanting to meet someone who's into indie music like I am.",
          action: 'WAIT'
        }
      },
      {
        user: '{{agent}}',
        content: {
          content:
            'I know just the person! Let me introduce you to Alex, who is a huge indie music fan.',
          action: 'INTRODUCE'
        }
      },
      {
        user: '{{agent}}',
        content: {
          content:
            "I've sent Alex a message to see if they're up for a chat. Hang tight!",
          action: 'WAIT'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: {
          content:
            "I'm trying to expand my professional network in the graphic design field.",
          action: 'WAIT'
        }
      },
      {
        user: '{{agent}}',
        content: {
          content:
            "Great! I'll introduce you to Jordan, who is well-connected in the graphic design community.",
          action: 'INTRODUCE'
        }
      },
      {
        user: '{{agent}}',
        content: {
          content:
            "Jordan is usually quick to respond. Let's give them a moment.",
          action: 'WAIT'
        }
      }
    ],

    [
      {
        user: '{{user1}}',
        content: {
          content:
            "I'm quite busy these days with work and barely have time for hobbies.",
          action: 'WAIT'
        }
      },
      {
        user: '{{agent}}',
        content: {
          content:
            'Understood. If you ever want to meet someone with similar interests, let me know!',
          action: 'WAIT'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: {
          content: "I've heard that chess is becoming popular again.",
          action: 'WAIT'
        }
      },
      {
        user: '{{agent}}',
        content: {
          content:
            "Yes, it's quite fascinating how it's regained popularity. If you're ever interested in meeting fellow chess enthusiasts, feel free to tell me!",
          action: 'WAIT'
        }
      }
    ],

    [
      {
        user: '{{user1}}',
        content: {
          content: "I'm not sure if I'm ready to meet new people yet.",
          action: 'WAIT'
        }
      },
      {
        user: '{{agent}}',
        content: {
          content:
            "No worries at all. Take your time, and I'm here when you're ready.",
          action: 'WAIT'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: {
          content:
            'Maybe meeting someone new would be nice. Oh, did you see the latest football match?',
          action: 'WAIT'
        }
      },
      {
        user: '{{agent}}',
        content: {
          content:
            "I did catch the highlights! If you decide you'd like to meet someone from the community, just let me know.",
          action: 'WAIT'
        }
      }
    ]
  ] as ActionExample[][]
} as Action
