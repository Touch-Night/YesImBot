export default {
  Group: {
    AllowedGroups: ["123"],
    AtReactPossibility: 1,
  },
  API: {
    APIList: [
      {
        APIType: "OpenAI",
        BaseURL: "/openai",
        APIKey: "sk-xxxxxxx",
        AIModel: "gpt-3.5-turbo",
      },
      {
        APIType: "Cloudflare",
        BaseURL: "/cloudflare",
        APIKey: "sk-xxxxxxx",
        AIModel: "gpt-3.5-turbo",
      },
      {
        APIType: "Ollama",
        BaseURL: "/ollama",
        APIKey: "sk-xxxxxxx",
        AIModel: "gpt-3.5-turbo",
      },
      {
        APIType: "Custom URL",
        BaseURL: "/custom",
        APIKey: "sk-xxxxxxx",
        AIModel: "gpt-3.5-turbo",
      },
    ],
  },

  Bot: {},
  Debug: {
    DebugAsInfo: false,
    DisableGroupFilter: true,
    AllowErrorFormat: true,
    UpdatePromptOnLoad: false,
  },
};