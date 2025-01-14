import jwt from '@tsndr/cloudflare-worker-jwt'
import {
  BgentRuntime,
  GoalStatus,
  SupabaseDatabaseAdapter,
  composeContext,
  createGoal,
  defaultActions,
  defaultEvaluators,
  embeddingZeroVector,
  messageHandlerTemplate,
  parseJSONObjectFromText,
  type Content,
  type Goal,
  type Memory,
  type Message,
  type State
} from 'bgent'
import { type UUID } from 'crypto'
import actions from './actions'
import evaluators from './evaluators'
import directions from './providers/directions'
import time from './providers/time'

const maxContinuesInARow = 2

/**
 * Handle an incoming message, processing it and returning a response.
 * @param message The message to handle.
 * @param state The state of the agent.
 * @returns The response to the message.
 */
async function handleMessage (
  runtime: BgentRuntime,
  message: Message,
  state?: State,
  event: { waitUntil: (promise: Promise<unknown>) => void } = self as unknown as { waitUntil: (promise: Promise<unknown>) => void }
) {
  console.log('**** handling message')
  const _saveRequestMessage = async (message: Message, state: State) => {
    const { content: senderContent /* userId, userIds, room_id */ } = message

    // we run evaluation here since some evals could be modulo based, and we should run on every message
    if ((senderContent as Content).content) {
      // const { data: data2, error } = await runtime.supabase.from('messages').select('*').eq('user_id', message.userId)
      //   .eq('room_id', room_id)
      //   .order('created_at', { ascending: false })

      // if (error) {
      //   console.log('error', error)
      //   // TODO: dont need this recall
      // } else if (data2.length > 0 && data2[0].content === message.content) {
      //   console.log('already saved', data2)
      // } else {
      //   await runtime.messageManager.createMemory({
      //     user_ids: userIds!,
      //     user_id: userId!,
      //     content: senderContent,
      //     room_id,
      //     embedding: embeddingZeroVector
      //   })
      // }
      await runtime.evaluate(message, state)
    }
  }

  await _saveRequestMessage(message, state as State)
  // if (!state) {
  state = (await runtime.composeState(message)) as State
  // }

  const context = composeContext({
    state,
    template: messageHandlerTemplate
  })

  if (runtime.debugMode) {
    console.log(context, 'Response Context')
  }

  let responseContent: Content | null = null
  const { userId, room_id } = message

  for (let triesLeft = 3; triesLeft > 0; triesLeft--) {
    console.log(context)
    const response = await runtime.completion({
      context,
      stop: []
    })

    if (!room_id) throw new Error('room_id is required')

    runtime.databaseAdapter.log({
        body: { message, context, response },
        user_id: userId,
        room_id,
        type: 'main_completion'
      })

    const parsedResponse = parseJSONObjectFromText(
      response
    ) as unknown as Content

    if (
      (parsedResponse.user as string)?.includes(
        (state as State).agentName as string
      )
    ) {
      responseContent = {
        content: parsedResponse.content,
        action: parsedResponse.action
      }
      break
    }
  }

  if (!responseContent) {
    responseContent = {
      content: '',
      action: 'IGNORE'
    }
  }

  const _saveResponseMessage = async (
    message: Message,
    state: State,
    responseContent: Content
  ) => {
    const { room_id } = message

    responseContent.content = responseContent.content?.trim()

    console.log('*** room_id', room_id)

    if (responseContent.content) {
      await runtime.messageManager.createMemory({
        user_id: runtime.agentId!,
        content: responseContent,
        room_id,
        embedding: embeddingZeroVector
      })
      await runtime.evaluate(message, { ...state, responseContent })
    } else {
      console.warn('Empty response, skipping')
    }
  }

  await _saveResponseMessage(message, state, responseContent)
  await runtime.processActions(message, responseContent, state)

  return responseContent
}

export function shouldSkipMessage (state: State, agentId: string): boolean {
  if (state.recentMessagesData && state.recentMessagesData.length > 2) {
    const currentMessages = state.recentMessagesData ?? []
    const lastThreeMessages = currentMessages.slice(-3)
    const lastThreeMessagesFromAgent = lastThreeMessages.filter(
      (message: Memory) => message.user_id === agentId
    )
    if (lastThreeMessagesFromAgent.length === 3) {
      return true
    }

    const lastTwoMessagesFromAgent = lastThreeMessagesFromAgent.slice(-2)
    const lastTwoMessagesFromAgentWithWaitAction =
      lastTwoMessagesFromAgent.filter(
        (message: Memory) => (message.content as Content).action === 'WAIT'
      )
    if (lastTwoMessagesFromAgentWithWaitAction.length === 2) {
      return true
    }
  }
  return false
}

interface HandlerArgs {
  event: { request: Request, waitUntil: (promise: Promise<unknown>) => void }
  env: {
    SUPABASE_URL: string
    SUPABASE_SERVICE_API_KEY: string
    OPENAI_API_KEY: string
    NODE_ENV: string
  }
  match?: RegExpMatchArray
  userId: UUID
}

class Route {
  path
  handler

  constructor ({
    path = /^/,
    handler
  }: {
    path?: RegExp
    handler: (args: HandlerArgs) => Promise<Response | null | unknown>
  }) {
    this.path = path
    this.handler = handler
  }
}

const routes: Route[] = [
  {
    path: /^\/api\/agents\/message/,
    async handler ({ event, env }: HandlerArgs) {
      const req = event.request
      if (req.method === 'OPTIONS') {
        return
      }

      const modifiedDefaultActions = defaultActions.map(action => {
        console.log('action', action)
        // if aciton name is ELABORATE, do stuff
        if (action.name !== 'ELABORATE') return action
        // modify the elaborate action's handler
        action.description = 'ONLY use this action when the message necessitates a follow up. Do not use this when asking a question (use WAIT instead). Do not use this action when the conversation is finished or the user does not wish to speak (use IGNORE instead). If the last message action was ELABORATE, and the user has not responded, use WAIT instead. Use sparingly! DO NOT USE WHEN ASKING A QUESTION, ALWAYS USE WAIT WHEN ASKING A QUESTION.'
        action.condition = 'Use when there is an intent to elaborate. Do NOT use when asking a question. Use WAIT instead. Use ELABORATE *very* sparingly, only when the message necessitates a follow up or needs to be broken up into multiple messages'
        action.handler = async (runtime: BgentRuntime, message: Message, state: State) => {
          state = (await runtime.composeState(message)) as State

          const context = composeContext({
            state,
            template: messageHandlerTemplate
          })

          if (runtime.debugMode) {
            console.log(context, 'Continued Response Context', 'cyan')
          }

          let responseContent
          const { userId, room_id } = message

          console.log('*** ELABORATING')
          console.log(context)

          for (let triesLeft = 3; triesLeft > 0; triesLeft--) {
            const response = await runtime.completion({
              context,
              stop: []
            })

            console.log('RESPONSE')

            runtime.databaseAdapter.log({
              body: { message, context, response },
              user_id: userId,
              room_id,
              type: 'elaborate'
            })

            const parsedResponse = parseJSONObjectFromText(
              response
            ) as unknown as Content
            if (
              (parsedResponse?.user as string).includes(state.agentName as string)
            ) {
              responseContent = parsedResponse
              break
            }
          }

          if (!responseContent) {
            if (runtime.debugMode) {
              console.error('No response content')
            }
            return
          }

          // prevent repetition
          const messageExists = state.recentMessagesData
            .filter((m) => m.user_id === runtime.agentId)
            .slice(0, maxContinuesInARow + 1)
            .some((m) => m.content === message.content)

          if (messageExists) {
            if (runtime.debugMode) {
              console.log(
                'Message already exists in recentMessagesData',
                '',
                'yellow'
              )
            }

            await runtime.messageManager.createMemory({
              user_id: runtime.agentId,
              content: responseContent,
              room_id,
              embedding: embeddingZeroVector
            })

            return responseContent
          }

          const _saveResponseMessage = async (
            message: Message,
            state: State,
            responseContent: Content
          ) => {
            const { room_id } = message

            responseContent.content = responseContent.content?.trim()

            if (responseContent.content) {
              await runtime.messageManager.createMemory({
                user_id: runtime.agentId!,
                content: responseContent,
                room_id,
                embedding: embeddingZeroVector
              })
              await runtime.evaluate(message, { ...state, responseContent })
            } else {
              console.warn('Empty response, skipping')
            }
          }

          await _saveResponseMessage(message, state, responseContent as Content)

          // if the action is ELABORATE, check if we are over maxContinuesInARow
          // if so, then we should change the action to WAIT
          if (responseContent.action === 'ELABORATE') {
            const agentMessages = state.recentMessagesData
              .filter((m) => m.user_id === runtime.agentId)
              .map((m) => (m.content as Content).action)

            const lastMessages = agentMessages.slice(0, maxContinuesInARow)
            if (lastMessages.length >= maxContinuesInARow) {
              const allContinues = lastMessages.every((m) => m === 'ELABORATE')
              if (allContinues) {
                responseContent.action = 'WAIT'
              }
            }
          }

          event.waitUntil(runtime.processActions(message, responseContent as Content, state))
          return responseContent
        }
        return action
      })

      let token = req.headers.get('Authorization')?.replace('Bearer ', '')
      const message = await req.json()

      if (!token && (message as { token: string }).token) {
        token = (message as { token: string }).token
      }

      const out = (token && jwt.decode(token)) as {
        payload: { sub: string, role: string, id: string }
        id: string
      }

      let userId = ''
      if (out?.payload?.role !== 'service_role') {
        userId = out?.payload?.sub || out?.payload?.id || out?.id

        if (!userId) {
          return _setHeaders(new Response('Unauthorized', { status: 401 }))
        }

        if (!userId) {
          console.log(
            'Warning, userId is null, which means the token was not decoded properly. This will need to be fixed for security reasons.'
          )
        }
      }

      const runtime = new BgentRuntime({
        debugMode: env.NODE_ENV === 'development',
        serverUrl: 'https://api.openai.com/v1',
        databaseAdapter: new SupabaseDatabaseAdapter(
          env.SUPABASE_URL,
          env.SUPABASE_SERVICE_API_KEY
        ),
        token: env.OPENAI_API_KEY,
        actions: [...actions, ...modifiedDefaultActions],
        evaluators: [...evaluators, ...defaultEvaluators],
        providers: [time, directions]
      })

      if (!(message as Message).userId && userId) {
        (message as Message).userId = userId as UUID
      }

      try {
        event.waitUntil(handleMessage(runtime, message as Message, null, event))
      } catch (error) {
        console.error('error', error)
        return new Response(error as string, { status: 500 })
      }

      return new Response('ok', { status: 200 })
    }
  },
  {
    path: /^\/api\/agents\/newuser/,
    async handler ({ event, env }: HandlerArgs) {
      const req = event.request

      if (req.method === 'OPTIONS') {
        return
      }

      let token = req.headers.get('Authorization')?.replace('Bearer ', '')
      const message = await req.json() as { user_id: UUID, token: string, room_id: UUID }

      if (!token && (message as unknown as { token: string }).token) {
        token = (message as unknown as { token: string }).token
      }

      const out = (token && jwt.decode(token)) as {
        payload: { sub: string, role: string, id: string }
        id: string
      }

      let userId = ''
      if (out?.payload?.role !== 'service_role') {
        userId = out?.payload?.sub || out?.payload?.id || out?.id

        if (!userId) {
          return _setHeaders(new Response('Unauthorized', { status: 401 }))
        }

        if (!userId) {
          console.log(
            'Warning, userId is null, which means the token was not decoded properly. This will need to be fixed for security reasons.'
          )
        }
      }
      const modifiedDefaultActions = defaultActions.map(action => {
        console.log('action', action)
        // if aciton name is ELABORATE, do stuff
        if (action.name !== 'ELABORATE') return action
        // modify the elaborate action's handler
        action.description = 'ONLY use this action when the message necessitates a follow up. Do not use this when asking a question (use WAIT instead). Do not use this action when the conversation is finished or the user does not wish to speak (use IGNORE instead). If the last message action was ELABORATE, and the user has not responded, use WAIT instead. Use sparingly! DO NOT USE WHEN ASKING A QUESTION, ALWAYS USE WAIT WHEN ASKING A QUESTION.'
        action.condition = 'Use when there is an intent to elaborate. Do NOT use when asking a question. Use WAIT instead. Use ELABORATE *very* sparingly, only when the message necessitates a follow up or needs to be broken up into multiple messages'
        action.handler = async (runtime: BgentRuntime, message: Message, state: State) => {
          state = (await runtime.composeState(message)) as State

          const context = composeContext({
            state,
            template: messageHandlerTemplate
          })

          if (runtime.debugMode) {
            console.log(context, 'Continued Response Context', 'cyan')
          }

          let responseContent
          const { userId, room_id } = message

          for (let triesLeft = 3; triesLeft > 0; triesLeft--) {
            const response = await runtime.completion({
              context,
              stop: []
            })

            console.log('RESPONSE')

            runtime.databaseAdapter.log({
              body: { message, context, response },
              user_id: userId,
              room_id,
              type: 'elaborate'
            })

            const parsedResponse = parseJSONObjectFromText(
              response
            ) as unknown as Content
            if (
              (parsedResponse?.user as string).includes(state.agentName as string)
            ) {
              responseContent = parsedResponse
              break
            }
          }

          if (!responseContent) {
            if (runtime.debugMode) {
              console.error('No response content')
            }
            return
          }

          // prevent repetition
          const messageExists = state.recentMessagesData
            .filter((m) => m.user_id === runtime.agentId)
            .slice(0, maxContinuesInARow + 1)
            .some((m) => m.content === message.content)

          if (messageExists) {
            if (runtime.debugMode) {
              console.log(
                'Message already exists in recentMessagesData',
                '',
                'yellow'
              )
            }

            await runtime.messageManager.createMemory({
              user_id: runtime.agentId!,
              content: responseContent,
              room_id,
              embedding: embeddingZeroVector
            })

            return responseContent
          }

          const _saveResponseMessage = async (
            message: Message,
            state: State,
            responseContent: Content
          ) => {
            const { room_id } = message

            responseContent.content = responseContent.content?.trim()

            if (responseContent.content) {
              await runtime.messageManager.createMemory({
                user_id: runtime.agentId!,
                content: responseContent,
                room_id,
                embedding: embeddingZeroVector
              })
              await runtime.evaluate(message, { ...state, responseContent })
            } else {
              console.warn('Empty response, skipping')
            }
          }

          await _saveResponseMessage(message, state, responseContent as Content)

          // if the action is ELABORATE, check if we are over maxContinuesInARow
          // if so, then we should change the action to WAIT
          if (responseContent.action === 'ELABORATE') {
            const agentMessages = state.recentMessagesData
              .filter((m) => m.user_id === runtime.agentId)
              .map((m) => (m.content as Content).action)

            const lastMessages = agentMessages.slice(0, maxContinuesInARow)
            if (lastMessages.length >= maxContinuesInARow) {
              const allContinues = lastMessages.every((m) => m === 'ELABORATE')
              if (allContinues) {
                responseContent.action = 'WAIT'
              }
            }
          }

          event.waitUntil(runtime.processActions(message, responseContent as Content, state))
          return responseContent
        }
        return action
      })
      const runtime = new BgentRuntime({
        debugMode: env.NODE_ENV === 'development',
        serverUrl: 'https://api.openai.com/v1',
        databaseAdapter: new SupabaseDatabaseAdapter(
          env.SUPABASE_URL,
          env.SUPABASE_SERVICE_API_KEY
        ),
        token: env.OPENAI_API_KEY,
        actions: [...actions, ...modifiedDefaultActions],
        evaluators: [...evaluators, ...defaultEvaluators],
        providers: [time, directions]
      })

      const zeroUuid = '00000000-0000-0000-0000-000000000000' as UUID

      const newMessage = {
        userId: message.user_id,
        room_id: message.room_id,
        content: { content: '*User has joined Cojourney. Greet them!*', action: 'NEW_USER' }
      } as Message

      const data = await runtime.databaseAdapter.getRoomsByParticipants([
        message.user_id as UUID,
        zeroUuid
  ])

      const room_id = data[0] as UUID

      const accountData = await runtime.databaseAdapter.getAccountById(message.user_id)

      console.log('accountData', accountData)

      if (!accountData) {
        return new Response('Account not found', { status: 404 })
      }

      const userName = accountData.name || 'the user'

      console.log('userName', userName)

      const newGoal: Goal = {
        name: 'First Time User Introduction (HIGH PRIORITY)',
        status: GoalStatus.IN_PROGRESS,
        room_id: room_id as UUID,
        user_id: message.user_id as UUID,
        objectives: [
          {
            description: `${userName} just joined Cojourney. Greet them and ask them if they are ready to get started.`,
            completed: false
          },
          {
            description: `Get basic details about ${userName}'s age and gender`,
            completed: false
          },
          {
            description: `Get details about ${userName}'s location-- where they live and how far they'd go to meet someone`,
            completed: false
          },
          {
            description: `Get details about ${userName}'s personal life`,
            completed: false
          },
          {
            description: `Get details about ${userName}'s career, school, or work`,
            completed: false
          },
          {
            description: `Get details about ${userName}'s goals for meeting new people: friendly, professional, romantic, personal growth oriented, etc`,
            completed: false
          },
          {
            description: `Let ${userName} know that they can can always chat with CJ to get help with something-- anything!`,
            completed: false
          },
          {
            description: 'Let the user know that CJ has enough information to start making introductions, but they more information they give, the more accurate the introductions will be.',
            completed: false
          }
        ]
      }

      await createGoal({
        runtime,
        goal: newGoal
      })

      await runtime.messageManager.createMemory({
        user_id: message.user_id,
        content: newMessage.content,
        room_id,
        embedding: embeddingZeroVector
      })

      console.log('handling message', newMessage)

      event.waitUntil(handleMessage(runtime, newMessage, null, event))

      return new Response('ok', { status: 200 })
    }
  },
  {
    // handle all other paths
    path: /^/,
    async handler ({}) {
      return new Response('Not found', { status: 404 })
    }
  }
]

async function handleRequest (
  event: { request: Request, waitUntil: (promise: Promise<unknown>) => void },
  env: Record<string, string>
) {
  const req = event.request as Request
  const { pathname } = new URL(req.url)

  if (req.method === 'OPTIONS') {
    return _setHeaders(
      new Response('', {
        status: 204,
        statusText: 'OK',
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': '*',
          'Access-Control-Allow-Headers': '*'
        }
      })
    )
  }

  for (const { path, handler } of routes) {
    const matchUrl = pathname.match(path as RegExp)

    if (matchUrl) {
      try {
        const response = await handler({
          event,
          env,
          match: matchUrl
        })

        return response
      } catch (err) {
        return _setHeaders(new Response(err as string, { status: 500 }))
      }
    }
  }

  return _setHeaders(
    new Response(
      JSON.stringify({ content: 'No handler found for this path' }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      }
    )
  )
}

addEventListener('fetch', event => {
  event.respondWith(handleEvent(event))
})

async function handleEvent (event) {
  try {
    // Call your original request handler and pass the environment variables

    const response = await handleRequest(event as { request: Request, waitUntil: (promise: Promise<unknown>) => void }, {
      // @ts-expect-error - wrangler env variables
      SUPABASE_URL,
      // @ts-expect-error - wrangler env variables
      SUPABASE_SERVICE_API_KEY,
      // @ts-expect-error - wrangler env variables
      OPENAI_API_KEY
    } as Record<string, string>)

    // Return the immediate response to the user
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return _setHeaders(response)
  } catch (error) {
    console.error('Fetch event handler error:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
}

function _setHeaders (res: Response) {
  const defaultHeaders = [
    {
      key: 'Access-Control-Allow-Origin',
      value: '*'
    },
    {
      key: 'Access-Control-Allow-Methods',
      value: 'GET,PUT,POST,DELETE,PATCH,OPTIONS'
    },
    {
      key: 'Access-Control-Allow-Headers',
      value: '*'
    },
    {
      key: 'Access-Control-Expose-Headers',
      value: '*'
    },
    {
      key: 'Access-Control-Allow-Private-Network',
      value: 'true'
    },
    {
      key: 'Cross-Origin-Opener-Policy',
      value: 'same-origin'
    },
    {
      key: 'Cross-Origin-Embedder-Policy',
      value: 'require-corp'
    },
    {
      key: 'Cross-Origin-Resource-Policy',
      value: 'cross-origin'
    }
  ]

  for (const { key, value } of defaultHeaders) {
    if (!res.headers.has(key)) res.headers.append(key, value)
  }
  return res
}
