import { Context, Next, h, Random, Session } from "koishi";

import JSON5 from "json5";

import { ResponseVerifier } from "./utils/verifier";

import { Config } from "./config";

import { isGroupAllowed } from "./utils/tools";

import { genSysPrompt, ensurePromptFileExists, getMemberName, getBotName } from "./utils/prompt";

import { SendQueue } from "./utils/queue";

import { processUserContent } from "./utils/content";

import { Adapter, register } from "./adapters";

export const name = "yesimbot";

export const usage = `\"Yes! I'm Bot!\" 是一个能让你的机器人激活灵魂的插件。
使用请阅读 [Github README](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 GPT-4o-mini 模型以获得最高性价比。
官方交流 & 测试群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)
`;

export { Config } from "./config";

export const inject = {
  optional: ['qmanager', 'interactions']
}

const sendQueue = new SendQueue();

const responseVerifier = new ResponseVerifier();

class APIStatus {
  private currentStatus: number = 0;

  updateStatus(APILength: number): void {
    this.currentStatus++;
    if (this.currentStatus >= APILength) {
      this.currentStatus = 0;
    }
  }
  getStatus(): number {
    return this.currentStatus;
  }
}

const status = new APIStatus();

export function apply(ctx: Context, config: Config) {
  let adapters: Adapter[] = [];
  // 当应用启动时更新 Prompt
  ctx.on("ready", async () => {
    // Return 之前，更新一下 adapters 吧
    adapters = updateAdapters(config.API.APIList);
    if (!config.Debug.UpdatePromptOnLoad) return;
    ctx.logger.info("正在尝试更新 Prompt 文件...");
    await ensurePromptFileExists(
      config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
      config.Debug.DebugAsInfo ? ctx : null,
      true
    );
  });

  ctx.command('清除记忆', '清除 BOT 对会话的记忆')
    .option('target', '-t <target> 指定要清除记忆的会话。使用 private:指定私聊会话', { authority: 3 })
    .usage('注意：如果使用 清除记忆 <target> 来清除记忆而不带-t参数，将会清除当前会话的记忆！')
    .example('清除记忆')
    .example('清除记忆 -t private:1234567890')
    .example('清除记忆 -t 987654321')
    .action(
      async ({ session, options }) => {
        const clearGroupId: string = options.target || (session.guildId ? session.guildId : `private:${session.userId}`);
        if (sendQueue.clearSendQueue(clearGroupId)) {
          return (`已清除关于 ${clearGroupId} 的记忆`);
        } else {
          return (`未找到关于 ${clearGroupId} 的记忆`);
        }
      }
    );

  ctx.middleware(async (session: any, next: Next) => {
    const groupId: string = session.guildId ? session.guildId : `private:${session.userId}`;
    const isPrivateChat = groupId.startsWith("private:");

    if (!session.groupMemberList && !isPrivateChat) {
      session.groupMemberList = await session.bot.getGuildMemberList(session.guildId);
      session.groupMemberList.data.forEach(member => {
        // 沙盒获取到的 member 数据不一样
        if (member.userId === member.username && !member.user) {
          member.user = {
            id: member.userId,
            name: member.username,
            userId: member.userId,
          };
          member.nick = member.username;
          member.roles = ['member'];
        }
        if (!member.nick) {
          member.nick = member.user.name || member.user.username;
        }
      });
    } else if (isPrivateChat) {
      session.groupMemberList = {
        data: [
          {
            user:
            {
              id: `${session.event.user.id}`,
              name: `${session.event.user.name}`,
              userId: `${session.event.user.id}`,
              avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${session.event.user.id}&spec=640`,
              username: `${session.event.user.name}`
            },
            nick: `${session.event.user.name}`,
            roles: ['member']
          },
          {
            user:
            {
              id: `${session.event.selfId}`,
              name: `${session.bot.user.name}`,
              userId: `${session.event.selfId}`,
              avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${session.event.selfId}&spec=640`,
              username: `${session.bot.user.name}`
            },
            nick: `${session.bot.user.name}`,
            roles: ['member']
          }
        ]
      };

      session.guildName = `${session.bot.user.name}与${session.event.user.name}的私聊`;
    }

    if (config.Debug.DebugAsInfo)
      ctx.logger.info(`New message received, guildId = ${groupId}`);

    if (!config.Group.AllowedGroups?.length) return next();

    const [isGuildAllowed, matchedConfig] = isGroupAllowed(groupId, config.Group.AllowedGroups, config.Debug.FirsttoAll);
    if (!isGuildAllowed) return next();
    const mergeQueueFrom = matchedConfig;

    const userContent = await processUserContent(config, session);

    // 更新消息队列，把这条消息加入队列
    sendQueue.updateSendQueue(
      groupId,
      await getMemberName(config, session, session.event.user.id),
      session.event.user.id,
      userContent.content,
      session.messageId,
      config.Group.Filter,
      config.Group.TriggerCount,
      session.event.selfId
    );

    // 检测是否达到发送次数或被 at
    // 返回 false 的条件：
    // 达到触发条数 或者 用户消息提及机器人且随机条件命中。也就是说：
    // 如果触发条数没有达到 (!isTriggerCountReached)
    // 并且消息没有提及机器人或者提及了机器人但随机条件未命中 (!(isAtMentioned && shouldReactToAt))
    // 那么就会执行内部的代码，即跳过这个中间件，不向api发送请求
    const isQueueFull: boolean = sendQueue.checkQueueSize(groupId, config.Group.SendQueueSize);
    const isMixedQueueFull: boolean = sendQueue.checkMixedQueueSize(mergeQueueFrom, config.Group.SendQueueSize);
    const loginStatus = await session.bot.getLogin();
    const isBotOnline = loginStatus.status === 1;
    const atRegex = new RegExp(`<at (id="${session.bot.selfId}".*?|type="all".*?${isBotOnline ? '|type="here"' : ''}).*?/>`);
    const isAtMentioned = atRegex.test(session.content);
    const isTriggerCountReached = sendQueue.checkTriggerCount(groupId, Random.int(config.Group.MinPopNum, config.Group.MaxPopNum), isAtMentioned);
    const shouldReactToAt = Random.bool(config.Group.AtReactPossibility);

    // 如果消息队列满了，出队消息到config.Group.SendQueueSize
    if (isQueueFull) {
      sendQueue.resetSendQueue(groupId, config.Group.SendQueueSize);
    }
    if (isMixedQueueFull) {
      ctx.logger.info("记忆槽位已满，超出的旧消息将被遗忘");
    }

    if (!isTriggerCountReached && !(isAtMentioned && shouldReactToAt)) {
      if (config.Debug.DebugAsInfo)
        ctx.logger.info(await sendQueue.getPrompt(mergeQueueFrom, config, session));
      return next();
    }

    if (!adapters || adapters.length === 0) { // 忘了设置 API 的情况，也是No API is available
      ctx.logger.info("无可用的 API，请检查配置");
      return next();
    }

    await ensurePromptFileExists(
      config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
      config.Debug.DebugAsInfo ? ctx : null
    );

    if (config.Debug.DebugAsInfo)
      ctx.logger.info(`Request sent, awaiting for response...`);

    // ctx.logger.info(session.guildName); 奇怪，为什么群聊时这里也是 undefined？

    // 获取 Prompt
    const SysPrompt: string = await genSysPrompt(
      config,
      // TODO: 私聊提示词
      // 使用完整写法 `session.event.guild.name` 会导致私聊时由于 `session.event.guild` 未定义而报错
      session.guildName ? session.guildName : session.event.user?.name,
      session
    );
    const chatData: string = await sendQueue.getPrompt(mergeQueueFrom, config, session);
    const curAPI = status.getStatus();
    status.updateStatus(adapters.length);

    if (config.Debug.DebugAsInfo)
      ctx.logger.info(
        `Using API ${curAPI}, BaseURL ${config.API.APIList[curAPI].BaseURL}.`
      );

    // 获取回答
    const response = await adapters[curAPI].runChatCompeletion(
      SysPrompt,
      chatData,
      config.Parameters,
      config.ImageViewer.Detail,
      config.ImageViewer.How,
      config.Debug.DebugAsInfo
    );

    if (config.Debug.DebugAsInfo)
      ctx.logger.info(JSON5.stringify(response, null, 2));

    const handledRes: {
      res: string;
      resNoTag: string;
      replyTo: string;
      quote: number;
      LLMResponse: any;
      usage?: any;
    } = await adapters[curAPI].handleResponse(
      response,
      config.Debug.AllowErrorFormat,
      config,
      session.groupMemberList.data
    );

    const finalRes: string = handledRes.res;
    let finalReplyTo: string = handledRes.replyTo;

    if (sendQueue.findGroupByMessageId(handledRes.quote, mergeQueueFrom) === null) {
      if (config.Debug.DebugAsInfo) {
        ctx.logger.info(
          `Quote message not found, using session_id.`
        );
      }
    } else {
      finalReplyTo = sendQueue.findGroupByMessageId(handledRes.quote, mergeQueueFrom);
    }

    if (config.Debug.LogicRedirect.Enabled) {
      const template = `回复于 ${finalReplyTo} 的消息已生成，来自 API ${curAPI}:
内容: ${(handledRes.LLMResponse.finReply ? handledRes.LLMResponse.finReply : handledRes.LLMResponse.reply)}
---
逻辑: ${handledRes.LLMResponse.logic}
---
指令：${handledRes.LLMResponse.execute ? handledRes.LLMResponse.execute : "无"}
---
消耗: 输入 ${handledRes?.usage["prompt_tokens"]}, 输出 ${handledRes?.usage["completion_tokens"]}`;
      await session.bot.sendMessage(config.Debug.LogicRedirect.Target, template);
    }

    responseVerifier.loadConfig(config);

    const isAllowed = await responseVerifier.verifyResponse(finalRes);

    if (!isAllowed) {
      if (config.Debug.DebugAsInfo) {
        ctx.logger.info(
          "Response filtered due to high similarity with previous response"
        );
      }
      return next();
    }

    responseVerifier.setPreviousResponse(finalRes);

    const sentences = finalRes.split(/(?<=[。?!？！])\s*/);

    sendQueue.updateSendQueue(
      finalReplyTo,
      await getBotName(config, session),
      session.event.selfId,
      handledRes.resNoTag,
      0, // session.messageId，但是这里是机器人自己发的消息，所以设为0
      config.Group.Filter,
      config.Group.TriggerCount,
      session.event.selfId
    );

    // 如果 AI 使用了指令
    if (handledRes.LLMResponse.execute) {
      handledRes.LLMResponse.execute.forEach(async (command) => {
        try {
          await session.bot.sendMessage(finalReplyTo, h("execute", {}, command)); // 执行每个指令
          ctx.logger.info(`已执行指令：${command}`);
        } catch (error) {
          ctx.logger.error(`执行指令<${command.toString()}>时出错: ${error}`)
        }
      });
    }

    let sentencesCopy = [...sentences];
    while (sentencesCopy.length > 0) {
      let sentence = sentencesCopy.shift();
      if (!sentence) { continue; }
      config.Bot.BotSentencePostProcess.forEach(rule => {
        const regex = new RegExp(rule.replacethis, "g");
        if (!rule.tothis) {
          sentence = sentence.replace(regex, "");
        } else {
          sentence = sentence.replace(regex, rule.tothis);
        }
      });
      if (config.Debug.DebugAsInfo) { ctx.logger.info(sentence); }

      // 按照字数等待
      const waitTime = Math.ceil(sentence.length / config.Bot.WordsPerSecond);
      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
      await session.bot.sendMessage(finalReplyTo, sentence);
    }
  });
}

function updateAdapters(APIList: Config["API"]["APIList"]): Adapter[] {
  let adapters: Adapter[] = [];
  for (const adapter of APIList) {
    adapters.push(register(
      adapter.APIType,
      adapter.BaseURL,
      adapter.APIKey,
      adapter.UID,
      adapter.AIModel
    ))
  }
  return adapters;
}
