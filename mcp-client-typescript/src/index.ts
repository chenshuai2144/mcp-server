// 引入 OpenAI 库，可兼容很多支持 openai 接口规范的大模型 API，本文使用 deepseek
import OpenAI from 'openai';
// 引入 Client 类
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// 引入 StdioClientTransport 类
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// 引入 readline/promises 模块，用于处理命令行输入
import readline from 'readline/promises';
// 引入 dotenv 库，用于加载环境变量
import dotenv from 'dotenv';
import express from 'express';
const app = express();
app.use(express.json());
const PORT = 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:8000');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // Allow Content-Type
  next();
});

// 加载环境变量
dotenv.config();

const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = 'https://api.deepseek.com';
const LLM_MODEL = 'deepseek-chat';
// 检查 LLM_API_KEY 是否设置，如果未设置则抛出错误
if (!LLM_API_KEY) {
  throw new Error('LLM_API_KEY is not set');
}

// 定义 MCPClient 类
class MCPClient {
  // 定义私有属性 mcp，类型为 Client
  mcp: Client;
  // 定义私有属性 openai，类型为 OpenAI
  openai: OpenAI;
  // 定义私有属性 transport，类型为 StdioClientTransport 或 null，初始值为 null
  private transport: StdioClientTransport | null = null;
  // 定义私有属性 tools，类型为数组，初始值为空数组
  private tools: OpenAI.ChatCompletionTool[] = [];

  // 构造函数
  constructor() {
    // 初始化 openai 实例，传入 API 密钥和基础 URL
    this.openai = new OpenAI({
      apiKey: LLM_API_KEY,
      baseURL: LLM_BASE_URL,
    });
    // 初始化 mcp 实例，传入客户端名称和版本
    this.mcp = new Client({ name: 'mcp-client-cli', version: '1.0.0' });
  }
  async connectToServer(serverScriptPath: string) {
    try {
      // 检查服务器脚本是否为 .js 文件
      const isJs = serverScriptPath.endsWith('.js');
      // 检查服务器脚本是否为 .py 文件
      const isPy = serverScriptPath.endsWith('.py');
      // 如果不是 .js 或 .py 文件，则抛出错误
      if (!isJs && !isPy) {
        throw new Error('Server script must be a .js or .py file');
      }
      // 根据不同情况选择命令
      const command = isPy
        ? process.platform === 'win32'
          ? 'python'
          : 'python3'
        : process.execPath;

      // 初始化 transport 实例
      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
        env: {
          GAODE_KEY: process.env.GAODE_KEY || '',
        },
        stderr: process.stderr,
      });
      // 连接到服务器
      await this.mcp.connect(this.transport);

      // 获取工具列表
      const toolsResult = await this.mcp.listTools();
      // 处理工具列表，转换为特定格式
      this.tools = toolsResult.tools.map((tool) => {
        return {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        };
      });
      // 打印连接成功信息和工具名称
      console.log(
        'Connected to server with tools:',
        this.tools.map((item) => item.function.name),
      );
    } catch (e) {
      // 打印连接失败信息和错误
      console.log('Failed to connect to MCP server: ', e);
      // 抛出错误
      throw e;
    }
  }
  async sendQuery(query: string) {
    // 初始化消息数组
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: query,
      },
    ];
    return this.openai.chat.completions.create({
      model: LLM_MODEL!,
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });
  }
  // 处理查询的方法
  async processQuery(query: string) {
    // 初始化消息数组
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: query,
      },
    ];

    // 调用 OpenAI 的聊天完成接口
    const response = await this.openai.chat.completions.create({
      model: LLM_MODEL!,
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });

    // 存储最终文本的数组
    const finalText: (string | null)[] = [];
    // 存储工具调用结果的数组
    const toolResults: any[] = [];

    // 遍历响应的选择
    for (const choice of response.choices) {
      // 如果没有工具调用
      if (
        !choice.message.tool_calls ||
        choice.message.tool_calls.length === 0
      ) {
        // 将消息内容添加到最终文本数组
        finalText.push(choice.message.content);
      } else {
        // 获取工具名称
        const toolName = choice.message.tool_calls[0].function.name;
        // 获取工具参数
        const toolArgs = JSON.parse(
          choice.message.tool_calls[0].function.arguments,
        );

        // 调用工具
        const result = await this.mcp.callTool({
          name: toolName,
          arguments: toolArgs,
        });
        // 将工具调用结果添加到工具结果数组
        toolResults.push(result);
        // 将工具调用信息添加到最终文本数组
        finalText.push(
          `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`,
        );

        // 将工具调用结果添加到消息数组
        messages.push({
          role: 'user',
          content: result.content as string,
        });

        // 再次调用 OpenAI 的聊天完成接口
        const response = await this.openai.chat.completions.create({
          model: LLM_MODEL!,
          max_tokens: 1000,
          messages,
        });

        // 将响应内容添加到最终文本数组
        finalText.push(response.choices[0].message.content);
      }
    }

    // 返回最终文本，用换行符连接
    return finalText.join('\n');
  }
  async chatLoop() {
    // 创建 readline 接口
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      // 打印客户端启动信息
      console.log('\nMCP Client Started!');
      // 打印提示信息
      console.log("Type your queries or 'quit' to exit.");

      // 循环接收用户输入
      while (true) {
        // 获取用户输入
        const message = await rl.question('\nQuery: ');
        // 如果用户输入为 'quit'，则退出循环
        if (message.toLowerCase() === 'quit') {
          break;
        }
        // 处理用户输入
        const response = await this.processQuery(message);
        // 打印响应结果
        console.log('\n' + response);
      }
    } catch (e) {
      // 打印错误信息
      console.error(e);
    } finally {
      // 关闭 readline 接口
      rl.close();
    }
  }
  async cleanup() {
    // 关闭 mcp 连接
    await this.mcp.close();
  }
  // 接下来的功能函数写在这里...
}

// 主函数
async function main() {
  // 检查命令行参数是否足够
  if (process.argv.length < 3) {
    // 打印使用说明
    console.log('Usage: node index.ts <path_to_server_script>');
    return;
  }
  // 创建 MCPClient 实例
  const mcpClient = new MCPClient();
  // 连接到服务器
  await mcpClient.connectToServer(process.argv[2]);

  app.post('/sse', async (req, res) => {
    // 设置 SSE 相关头部
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*'); // 允许跨域

    try {
      const query = req.body?.query;
      const runId = query + `-${Date.now()}`;

      // 将工具调用信息添加到最终文本数组
      res.write(
        `data: ${JSON.stringify({
          chat_result: null,
          process_status: 'PROC_WHITEBOX',
          stream: null,
          white_box_process: [
            {
              category: 'DeepThink',
              info: `正在进行意图识别`,
              input: {
                query,
              },
              runId,
              output: { data: '识别中。。。', type: 'TOKEN' },
            },
          ],
        })}\n\n`,
      );

      // 调用 OpenAI 的聊天完成接口
      const response = await mcpClient.sendQuery(query);
      const messages = [
        {
          role: 'user',
          content: query,
        },
      ];

      for (const choice of response.choices) {
        // 如果没有工具调用
        if (
          !choice.message.tool_calls ||
          choice.message.tool_calls.length === 0
        ) {
          res.write(
            `data: ${JSON.stringify({
              chat_result: null,
              process_status: 'PROC_WHITEBOX',
              stream: null,
              white_box_process: [
                {
                  category: 'DeepThink',
                  info: `正在进行意图识别`,
                  input: {
                    query,
                  },
                  runId,
                  output: {
                    data: '\n 无需使用工具，直接输出',
                    type: 'Token',
                  },
                },
              ],
            })}\n\n`,
          );
          res.write(
            `data: ${JSON.stringify({
              chat_result: null,
              process_status: 'PROC_WHITEBOX',
              stream: null,
              white_box_process: [
                {
                  category: 'DeepThink',
                  info: `正在进行意图识别`,
                  input: {
                    query,
                  },
                  runId,
                  output: {
                    data: '',
                    type: 'END',
                  },
                },
              ],
            })}\n\n`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          // 将消息内容添加到最终文本数组
          res.write(`data: ${JSON.stringify(choice.message)}\n\n`);
        } else {
          // 获取工具名称
          const toolName = choice.message.tool_calls[0].function.name;

          // 将工具调用信息添加到最终文本数组
          res.write(
            `data: ${JSON.stringify({
              chat_result: null,
              process_status: 'PROC_WHITEBOX',
              stream: null,
              white_box_process: [
                {
                  category: 'DeepThink',
                  info: `正在查找调用的工具`,
                  input: {
                    inputArgs: {
                      query,
                    },
                  },
                  runId,
                  output: {
                    data: '\n 根据用户的输入，选择了' + toolName + '工具',
                    type: 'Token',
                  },
                },
              ],
            })}\n\n`,
          );
          // 获取工具参数
          const toolArgs = JSON.parse(
            choice.message.tool_calls[0].function.arguments,
          );

          const toolID = toolName + `-${Date.now()}`;
          res.write(
            `data: ${JSON.stringify({
              chat_result: null,
              process_status: 'PROC_WHITEBOX',
              stream: null,
              white_box_process: [
                {
                  category: 'ToolCall',
                  info: `Calling tool ${toolName}`,
                  input: {
                    inputArgs: toolArgs,
                  },
                  runId: toolID,
                },
              ],
            })}\n\n`,
          );
          // 调用工具
          const result = await mcpClient.mcp.callTool({
            name: toolName,
            arguments: toolArgs,
          });

          // 将工具调用信息添加到最终文本数组
          res.write(
            `data: ${JSON.stringify({
              chat_result: null,
              process_status: 'PROC_WHITEBOX',
              stream: null,
              white_box_process: [
                {
                  category: 'ToolCall',
                  info: `Calling tool ${toolName}`,
                  input: {
                    toolArgs,
                  },
                  runId: toolID,
                  output: {
                    response: result.content,
                  },
                },
              ],
            })}\n\n`,
          );

          // 将工具调用结果添加到消息数组
          messages.push({
            role: 'user',
            content: result.content as string,
          });

          // 再次调用 OpenAI 的聊天完成接口
          const response = await mcpClient.openai.chat.completions.create({
            model: LLM_MODEL!,
            max_tokens: 1000,
            messages: messages as any,
            stream: true,
          });
          for await (const chunk of response) {
            res.write(
              `data: ${JSON.stringify({
                content: chunk?.choices?.at(0)?.delta?.content,
              })}\n\n`,
            );
          }
        }
      }

      // for await (const chunk of response) {
      //   res.write(`data: ${JSON.stringify(chunk?.choices?.at(0))}\n\n`);
      // }
    } catch (error) {
    } finally {
      res.end();
    }

    // 客户端断开连接时清理
    req.on('close', () => {
      res.end();
      console.log('Client disconnected');
    });
  });
  app.options('/sse', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*'); // 允许跨域
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); // 允许 POST 和 OPTIONS 请求
    res.end();
  });

  // // 启动聊天循环
  // await mcpClient.chatLoop();
}

// 调用主函数
main();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
