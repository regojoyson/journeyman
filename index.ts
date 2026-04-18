import { query } from "@anthropic-ai/claude-agent-sdk";

// Agentic loop: streams messages as Claude works
for await (const message of query({
  prompt: "chow are oyu?",
  options: {
    allowedTools: ["Read"],
    tools:[],
    settingSources: [],
    settings: {
      allowedMcpServers: [],
    }

  },
})) {

  if (message.type === "system" && message.subtype === "init") {
    console.log("Available MCP tools:", message.mcp_servers);

    // Check loaded plugins
    console.log("Plugins:", message.plugins);
    // Example: [{ name: "my-plugin", path: "./my-plugin" }]

    // Check available commands from plugins
    console.log("Commands:", message.slash_commands);
    // Example: ["/help", "/compact", "my-plugin:custom-command"]

    console.log("skills:", message.skills);

    console.log("tools:", message.tools);

    console.log("permission mode:", message.permissionMode);
  }



  if (message.type === "assistant" && message.message?.content) {
    for (const block of message.message.content) {
      if ("text" in block) {
        console.log(block.text);       // Claude's reasoning
      } else if ("name" in block) {
        console.log(`Tool: ${block.name}`); // Tool being called
      }
    }
  } else if (message.type === "result") {
    console.log(`\nDone: ${message.subtype}`);
  }
}
