import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from '@jest/globals'
import { type Session, type User } from '@supabase/supabase-js'
import { composeContext, createRuntime, getRelationship, type BgentRuntime, type State, SupabaseDatabaseAdapter } from 'bgent'
import { type UUID } from 'crypto'
import { config } from 'dotenv'
import { zeroUuid } from '../../../test/constants'
import {
  getRelevantRelationships,
  action as introduce,
  template
} from '../introduce'

// use .dev.vars for local testing
config({ path: '../../.env' })

describe('INTRODUCE Action Tests', () => {
  let runtime: BgentRuntime
  let session: Session
  let room_id: UUID
  // Helper function for user creation or sign-in
  async function ensureUser (email: string, password: string): Promise<User> {
    const {
      data: { session: { user } },
      error: signInError
    } = await runtime.supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      const {
        data: { session: { user: newUser } },
        error: signUpError
      } = await runtime.supabase.auth.signUp({ email, password })
      if (signUpError) {
        throw signUpError
      }
      if (!newUser) throw new Error('User not created')
      await ensureAccount(newUser) // Ensure account after user creation
      return newUser
    }

    if (!user) {
      throw new Error('User not found')
    }

    await ensureAccount(user) // Ensure account for existing user
    return user
  }

  async function ensureAccount (user: User) {
    const { data: accounts, error: accountsError } = await runtime.supabase
      .from('accounts')
      .select('*')
      .eq('id', user.id)

    if (accountsError) {
      throw new Error(accountsError.message)
    }

    if (accounts && accounts.length === 0) {
      console.log('*** user', user)
      const { error: insertError } = await runtime.supabase
        .from('accounts')
        .insert({
          name: user.email,
          email: user.email,
          avatar_url: ''
        })

      if (insertError) {
        throw new Error(insertError.message)
      }
    }
  }

  // Cleanup function to reset the environment after tests
  async function cleanup (userIds: UUID[]) {
    await Promise.all([
      runtime.messageManager.removeAllMemoriesByUserIds(userIds),
      runtime.descriptionManager.removeAllMemoriesByUserIds(userIds)
    ])
  }

  beforeAll(async () => {
    ({ session, runtime } = await createRuntime({
      env: process.env,
      actions: [introduce]
    }))

    const data = await getRelationship({
      runtime,
      userA: session.user?.id as UUID,
      userB: zeroUuid
    })

    room_id = data?.room_id
  })

  beforeEach(async () => {
    await cleanup([]) // Pass any userIds of users created during tests
  })

  afterAll(async () => {
    await cleanup([]) // Pass any userIds of users created during tests
  })

  test('INTRODUCE is included in actionNames when the user has a description', async () => {
    const user = await ensureUser(
      'user_with_description@example.com',
      'password'
    )
    await runtime.descriptionManager.createMemory(
      await runtime.descriptionManager.addEmbeddingToMemory({
        user_id: user?.id as UUID,
        content: { content: 'Likes indie music' },
        room_id
      })
    )

    const message = {
      userId: user?.id as UUID,
      room_id,
      content: {
        content:
          "I'd like to meet someone who enjoys indie music as much as I do.",
        action: 'WAIT'
      }
    }

    const state = await runtime.composeState(message)
    expect(state.actionNames).toContain('INTRODUCE')
  })

  test('INTRODUCE is not included in actionNames when the user lacks a description', async () => {
    const userWithoutDescription = await ensureUser(
      'user_without_description@example.com',
      'password'
    )

    const message = {
      userId: userWithoutDescription.id as UUID,
      room_id,
      content: { content: "I'm new here!", action: 'WAIT' }
    }

    const state = await runtime.composeState(message)
    expect(state.actionNames).not.toContain('INTRODUCE')
  })

  // Additional tests for Rolodex functionality as per the requirements
  describe('Rolodex Functionality', () => {
    let mainUser: User,
      session: Session,
      runtime: BgentRuntime,
      similarUser: User,
      differentUser: User

    beforeEach(async () => {
      // Create main user and add a description
      ({ session, runtime } = await createRuntime({
        env: process.env,
        actions: [introduce]
      }))

      mainUser = session.user as User

      await runtime.descriptionManager.createMemory(
        await runtime.descriptionManager.addEmbeddingToMemory({
          user_id: mainUser.id as UUID,
          content: { content: 'Enjoys playing Guitar Hero' },
          room_id: zeroUuid
        })
      )

      // Create a similar user and add a description
      similarUser = await ensureUser('similaruser@example.com', 'password')
      await runtime.descriptionManager.createMemory(
        await runtime.descriptionManager.addEmbeddingToMemory({
          user_id: similarUser.id as UUID,
          content: { content: 'Loves music and Guitar Hero' },
          room_id: zeroUuid
        })
      )

      // Create a different user and add a description
      differentUser = await ensureUser('differentuser@example.com', 'password')
      await runtime.descriptionManager.createMemory(
        await runtime.descriptionManager.addEmbeddingToMemory({
          user_id: differentUser.id as UUID,
          content: { content: 'Enjoys outdoor activities' },
          room_id: zeroUuid
        })
      )
    }, 60000)

    test('Rolodex returns potential connections based on user descriptions', async () => {
      const message = {
        userId: mainUser.id as UUID,
        content: {
          content: 'Looking to connect with someone with similar interests.',
          action: 'WAIT'
        },
        room_id,
        userIds: [mainUser.id as UUID, zeroUuid]
      }

      // select all from descriptions
      // @ts-expect-error - supabase is private atm
      const response = await (runtime.databaseAdapter as SupabaseDatabaseAdapter).supabase.from('descriptions').select('*')
      if (response.error) {
        throw new Error(response.error.message as string)
      }

      const relevantRelationships = await getRelevantRelationships(
        runtime,
        message,
        1
      )

      expect(relevantRelationships).toContain(similarUser.email) // Assuming the rolodex function lists users by their email or some identifier
      expect(relevantRelationships).not.toContain(differentUser.email)
    }, 60000)

    test('More similar user is higher in the rolodex list than the less similar user', async () => {
      const message = {
        userId: mainUser.id as UUID,
        content: {
          content: 'Who should I meet that enjoys music as much as I do?',
          action: 'WAIT'
        },
        room_id
      }

      const state = (await runtime.composeState(message)) as State

      // select all from descriptions
      const response = await runtime.supabase.from('descriptions').select('*')
      if (response.error) {
        throw new Error(response.error.message)
      }

      const relevantRelationships = await getRelevantRelationships(
        runtime,
        message,
        1
      )

      console.log('relevantRelationships', relevantRelationships)

      const context = composeContext({
        state: { ...state, relevantRelationships },
        template
      })

      const differentUserIndex = relevantRelationships.indexOf(
        differentUser.email as string
      )

      expect(context).toContain(similarUser.email)

      expect(differentUserIndex).toBe(-1)
    }, 60000)

    afterEach(async () => {
      await cleanup([
        mainUser.id as UUID,
        similarUser.id as UUID,
        differentUser.id as UUID
      ])
    })
  })
})
