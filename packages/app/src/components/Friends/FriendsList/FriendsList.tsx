import { Flex, Text, Title, useMantineTheme } from "@mantine/core"
import React from "react"
import { type IFriend, type IUser } from "../../../store/useGlobalStore"
import getFriend from "../../../utils/getFriend"
import UserAvatarWithIndicator from "../../UserAvatarWithIndicator/UserAvatarWithIndicator"
import UserPopup from "../../UserPopup/UserPopup"
import { getAvatarImage } from "../../../helpers/getAvatarImage"

const FriendsList = ({
  friends,
  user
}: {
  friends: IFriend[]
  user: IUser
}): JSX.Element => {
  const theme = useMantineTheme()

  const filteredFriends = friends.filter((friendship: IFriend) => {
    const { friendData } = getFriend({
      friendship,
      userId: user.uid || ""
    })
    return (!!friendData)
  })

  if (filteredFriends.length === 0) {
    return <p>No connections yet!</p>
  }

  return (
    <div>
      {filteredFriends.map((friendship: IFriend) => {
        const friendData = getFriend({
          friendship,
          userId: user.uid || ""
        }).friendData
        return (
          <UserPopup
            key={friendship.id}
          >
            <Flex
              sx={{
                padding: 5,
                borderRadius: 5,
                cursor: "pointer",
                ":hover": {
                  backgroundColor:
                    theme.colorScheme === "dark"
                      ? theme.colors.dark[6]
                      : theme.colors.gray[1]
                }
              }}
              key={friendship.id}
              align="center"
              mt={10}
            >
              <UserAvatarWithIndicator
                image={friendData?.avatar_url || getAvatarImage(friendData?.name || friendData?.email || "")}
                size={40}
                // @ts-expect-error
                user_email={friendData.email}
                checkOnline
              />

              <div style={{ marginLeft: 10 }}>
                <Flex>
                  <Title
                    lineClamp={1}
                    mr={10}
                    size={16}
                  >
                    {friendData?.name}
                  </Title>
                </Flex>
                <Text
                  lineClamp={1}
                  c="dimmed"
                  size={14}
                >
                  {friendData?.email}
                </Text>
              </div>
            </Flex>
          </UserPopup>
        )
      })}
    </div>
  )
}

export default FriendsList
