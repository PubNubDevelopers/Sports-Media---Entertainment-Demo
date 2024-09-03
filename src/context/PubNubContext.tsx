"use client"

import { Channel, Chat, Message, User } from "@pubnub/chat";
import React, { ReactNode, useEffect, useState } from "react";

// Define the type for PollResults
type PollResults = {
  Home: number;
  Away: number;
  Tie: number;
  Total: number;
};

export interface PubNubType {
  chat: Chat | undefined;
  user: User | undefined;
  channel: Channel | undefined;
  pollChannel: Channel | undefined;
  playbyplayState: any;
  gameState: any;
  pollResults: any;
  isIntermission: boolean,
  pollResultSubmitted: boolean,
  videoSyncData: {startTimeInSeconds: number, endTimeInSeconds: number} | null,
  sportsBookData: { [key: string]: any }
  createUser: (username: string, profileImg: string) => Promise<void>;
  createChannel: (id: string) => Promise<void>;
  createPollChannel: (id: string) => Promise<void>;
  subscribeToGame: (id: string) => void;
  subscribeToPoll: (id: string) => void;
  subscribeToBetting: (id: string) => Promise<void>;
  submitPollResult: (vote: "Home" | "Away" | "Tie") => Promise<void>;
}

export const PubNubConext = React.createContext<PubNubType | null>(null);

export const PubNubContextProvider = ({ children }: { children: ReactNode }) => {
  const [chat, setChat] = useState<Chat>();
  const [user, setUser] = useState<User>();
  const [channel, setChannel] = useState<Channel>();
  const [pollChannel, setPollChannel] = useState<Channel>();
  const [playbyplayState, setplaybyplayState] = useState<any[]>([]);
  const [gameState, setGameState] = useState<any>({});
  const [isIntermission, setIsIntermission] = useState<boolean>(false);
  const [pollResults, setPollResults] = useState<PollResults>({
    Home: 0,
    Away: 0,
    Tie: 0,
    Total: 0,
  });
  const [pollResultSubmitted, setPollResultSubmitted] = useState<boolean>(false);
  const [videoSyncData, setVideoSyncData] = useState<{startTimeInSeconds: number, endTimeInSeconds: number} | null>(null);
  const [sportsBookData, setSportsBookData] = useState<{[key: string]: any}>({});

  const initChat = async () => {
    const userId = `user_${Math.floor(Math.random() * 1000)}_${Date.now()}`;
    try{
      const chat = await Chat.init({
        publishKey: process.env.NEXT_PUBLIC_PUBNUB_PUBLISH_KEY,
        subscribeKey: process.env.NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY,
        userId: userId,
        typingTimeout: 5000,
        storeUserActivityTimestamps: true,
        storeUserActivityInterval: 300000, /* 5 minutes */
      });

      setChat(chat);
      setUser(chat.currentUser);
    }
    catch(e){
      console.error("Failed to initialize PubNub:", e);
    }
  };

  const createUser = async (username: string, profileImg: string) => {
    console.log("Running create User");
    if (chat === undefined) {
      throw new Error("This function must be used within a PubNubProvider");
    }

    var newUser;

    try{
      newUser = await chat.currentUser.update({
        name: username,
        profileUrl: profileImg
      });
    }
    catch(e){
      console.log("Failed to updated user: ", e);
    }

    setUser(newUser);
  }

  const createChannel = async (id: string) => {
    let channel = await getChannel(id);
    setChannel(channel);
  }

  const createPollChannel = async (id: string) => {
    let channel = await getChannel(id);
    setPollChannel(channel);
  }

  const getChannel = async (id: string): Promise<Channel> => {
    if(chat === undefined){
      throw new Error("This function must be used within a PubNubProvider");
    }
    let newChannel: Channel | null;

    newChannel = await chat.getChannel(id);

    if(newChannel === null){
      // We want to create a public conversation to let users engage in open conversation with many people.
      // Unlike group chats, anyone can join public channels.
      newChannel = await chat.createPublicConversation({
        channelId: id,
        channelData: {
          name: `${id}`,
          description: "Custom Channel",
        },
      });
    }

    console.log(newChannel);

    return newChannel;
  }

  function promiseTimeout(delayms: number) {
    return new Promise(function (resolve, reject) {
      setTimeout(resolve, delayms);
    })
  }

  const updatePlayStates = (newPlay: any) => {
    setplaybyplayState((prevState: any) => [...prevState, newPlay]);
  };

  const subscribeToBetting = async (id: string) => {
    if(!chat) return;

    let betChannel: Channel | null;

    betChannel = await getChannel(id);

    betChannel.join(async (message: Message) => {
      try {
        const messageContent = message.content.text;
        const parsedData = JSON.parse(messageContent);

        // console.log("Data Received");
        // console.log(parsedData);

        // Assuming parsedData has a structure like { sportsbook: string, odds: any }
        const sportsbook = parsedData.sportsbook;

        // Update the current data for this sportsbook in the state
        setSportsBookData(prevData => ({
          ...prevData,
          [sportsbook]: parsedData.odds,
        }));

        // Now sportsBookData[sportsbook] will hold the latest data for that sportsbook

      } catch (error) {
        console.error("Failed to parse bet data:", error);
      }
    });
  }

  const subscribeToGame = async (id: string) => {
    if (!chat) return;

    let gameChannel: Channel | null;

    gameChannel = await getChannel(id);

    gameChannel.join(async (message: Message) => {
      try {
        const messageContent = message.content.text;
        const parsedData = JSON.parse(messageContent);

        // console.log(parsedData);

        if (parsedData.restart) {
          console.log("Parsed Data Restart Received");
          setIsIntermission(true);
          setGameState({});
          setplaybyplayState([]);
          await promiseTimeout(3000);
          return;
        }
        else if(!isIntermission){
          setIsIntermission(false);
        }

        // Store video sync data if available
        if (parsedData.videoSyncTime) {
          const { videoStartTimeInSeconds, videoEndTimeInSeconds } = parsedData.videoSyncTime;
          setVideoSyncData({ startTimeInSeconds: videoStartTimeInSeconds, endTimeInSeconds: videoEndTimeInSeconds });
        }

        updatePlayStates(parsedData.play);
        setGameState(parsedData.gameState);
      } catch (error) {
        console.error("Failed to parse message content:", error);
      }
    });
  };

  const subscribeToPoll = async (id: string) => {
    if(!chat) return;

    let pollChannel: Channel | null;

    pollChannel = await getChannel(id);

    console.log("Fetching Poll History");

    await fetchPollHistory(id);

    pollChannel.join(async (message: Message) => {
      try {
        const messageContent = message.content.text;

        console.log("Poll submitted");
        console.log(messageContent);

        if (messageContent.includes("Home") || messageContent.includes("Away") || messageContent.includes("Tie")) {
          setPollResults(prevResults => {
            // Create a new object based on the previous state
            const updatedResults = {
              ...prevResults,
              Total: prevResults.Total + 1, // Increment the total vote count
            };

            // Update vote counts based on the new vote
            if (messageContent.includes("Home")) {
              updatedResults.Home += 1;
            } else if (messageContent.includes("Away")) {
              updatedResults.Away += 1;
            } else if (messageContent.includes("Tie")) {
              updatedResults.Tie += 1;
            }

            // Return the new results object
            return updatedResults;
          });
        }
      } catch (error) {
        console.error("Failed to process poll message:", error);
      }
    });
  }

  const submitPollResult = async (vote: "Home" | "Away" | "Tie") => {
    if (!pollChannel) return;
    try {
      const message = vote;
      await pollChannel.sendText(message, {
        storeInHistory: true,
      });
      console.log("Poll result submitted:", message);
    } catch (error) {
      console.error("Failed to submit poll result:", error);
    }

    setPollResultSubmitted(true);
  };

  const fetchPollHistory = async (id: string) => {

    let pollChannel: Channel | null;

    pollChannel = await getChannel(id);

    try {
      const history = await pollChannel.getHistory({
        count: 100, // Adjust the count as needed
      });

      const messages = history?.messages || [];
      const voteCounts = {
        Home: 0,
        Away: 0,
        Tie: 0,
        total: 0,
      };

      for (let i = 0; i < messages.length; i++) {
        const content = messages[i].content.text;

        if (content.includes("Home")) {
          voteCounts.Home += 1;
        } else if (content.includes("Away")) {
          voteCounts.Away += 1;
        } else if (content.includes("Tie")) {
          voteCounts.Tie += 1;
        }

        voteCounts.total += 1;
      }

      setPollResults({
        Home: voteCounts.Home,
        Away: voteCounts.Away,
        Tie: voteCounts.Tie,
        Total: voteCounts.total
      });
    } catch (error) {
      console.error("Failed to fetch poll history:", error);
    }
  };

  // Initialize the PubNub instance
  useEffect(() => {
    if (!chat) {
      initChat();
    }
  }, [chat, initChat]);

  return (
    <PubNubConext.Provider
      value={{
        chat,
        user,
        channel,
        pollChannel,
        playbyplayState,
        gameState,
        pollResults,
        isIntermission,
        pollResultSubmitted,
        videoSyncData,
        sportsBookData,
        createUser,
        createChannel,
        subscribeToGame,
        subscribeToPoll,
        submitPollResult,
        createPollChannel,
        subscribeToBetting
      }}
    >
      {children}
    </PubNubConext.Provider>
  );
}
