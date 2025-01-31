import {
  ActionIcon,
  Flex,
  Loader,
  Menu,
  Text,
  Title
} from "@mantine/core"
import React from "react"
import { MoreHorizontal, Trash, UserPlus } from "react-feather"
import useHandleFriendsRequests from "../../../Hooks/relationships/useHandleFriendRequests"
import useGlobalStore from "../../../store/useGlobalStore"
import getFriend from "../../../utils/getFriend"
import UserAvatarWithIndicator from "../../UserAvatarWithIndicator/UserAvatarWithIndicator"
import UserPopup from "../../UserPopup/UserPopup"
import { getAvatarImage } from "../../../helpers/getAvatarImage"

const FriendsRequestsList = (): JSX.Element => {
  const {
    relationships: { requests },
    user: { uid }
  } = useGlobalStore()

  const { isLoading, handleAcceptFriendRequest, handleDeleteFriendship } =
    useHandleFriendsRequests()

  if (requests.length === 0) {
    return (
      <p>No friend requests</p>
    )
  }

  return (
    <div>
      {requests.map((friendship) => {
        const { friendData } = getFriend({
          friendship,
          userId: uid || ""
        })

        if (!friendData) return null

        return (
          <Flex
            sx={{
              padding: 5,
              borderRadius: 5,
              cursor: "pointer"
            }}
            key={friendship.id}
            align="center"
            justify="space-between"
            mt={10}
          >
            <Flex>
              <UserPopup>
                <UserAvatarWithIndicator
                  image={friendData?.avatar_url || getAvatarImage(friendData?.name || friendData?.email || "")}
                  size={40}
                  user_email={friendData.email || ""}
                  checkOnline
                />
              </UserPopup>

              <div style={{ marginLeft: 10 }}>
                <Flex>
                  <Title
                    lineClamp={1}
                    mr={10}
                    size={16}
                  >
                    {friendData.name}
                  </Title>
                </Flex>
                <Text
                  lineClamp={1}
                  c="dimmed"
                  size={14}
                >
                  {friendData.email}
                </Text>
              </div>
            </Flex>
            <Menu
              shadow="md"
              width={200}
              position="bottom"
              withinPortal
              withArrow
            >
              <Menu.Target>
                <ActionIcon disabled={isLoading}>
                  {isLoading
? (
                    <Loader size={16} />
                  )
: (
                    <MoreHorizontal size={20} />
                  )}
                </ActionIcon>
              </Menu.Target>

              <Menu.Dropdown>
                <Menu.Item
                  onClick={() => {
                    handleAcceptFriendRequest({
                      friendData,
                      friendship
                    })
                  }}
                  icon={<UserPlus size={16} />}
                >
                  Accept
                </Menu.Item>

                <Menu.Divider />

                <Menu.Label>Danger zone</Menu.Label>
                <Menu.Item
                  onClick={() => {
                    handleDeleteFriendship({
                      friendship
                    })
                  }}
                  icon={<Trash size={16} />}
                >
                  Decline Request
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Flex>
        )
      })}
    </div>
  )
}

export default FriendsRequestsList
