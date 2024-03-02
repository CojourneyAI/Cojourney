import { Box, ScrollArea, Skeleton } from "@mantine/core"
import React, { useEffect, useRef } from "react"
import useGlobalStore, { type IDatabaseMessage } from "../../../../store/useGlobalStore"

import EmptyRoom from "../../../../components/InfoScreens/EmptyRoom"
import Message from "./Message/Message"

const Messages = ({ userMessage }: { userMessage: IDatabaseMessage }): JSX.Element => {
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView()
  }
  const {
    user,
    currentRoom: { messages, isLoadingMessages }
  } = useGlobalStore()

  useEffect(() => {
    scrollToBottom()
  }, [messages?.length, userMessage])

  if (isLoadingMessages) {
    return (
      <>
        <Skeleton
          h={30}
          mb={10}
          width="50%"
        />
        <Skeleton
          h={30}
          mb={10}
          width="80%"
        />
        <Skeleton
          h={30}
          mb={10}
          width="35%"
        />
        <Skeleton
          h={30}
          mb={10}
          width="40%"
        />
        <Skeleton
          h={30}
          mb={10}
          width="60%"
        />
        <Skeleton
          h={30}
          mb={10}
          width="20%"
        />
        <Skeleton
          h={30}
          mb={10}
          width="30%"
        />
      </>
    )
  }

  if (!messages) return <p>Error loading messages</p>
  if (messages.length === 0) return <EmptyRoom />

  return (
    <ScrollArea
      w="100%"
      h="calc(100%)"
    >
      <Box>
        {(userMessage ? [...messages
          .filter(
            // filter out messages that match userMessage
            (message) => message.content.content !== userMessage.content.content
          ), { ...userMessage, userData: user }] : messages)
        .sort(
          // sort by created_at
          (a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime()
        ).map((message) => {
          return (
            <div key={message.created_at}>
              <Message
                key={message.id}
                message={message as IDatabaseMessage}
              />
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </Box>
    </ScrollArea>
  )
}

export default Messages
