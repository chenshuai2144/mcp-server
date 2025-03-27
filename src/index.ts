// 导入 McpServer 类，用于创建 MCP Server 的实例
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// 导入 StdioServerTransport 类，用于实现 Client 和 Server 的标准通信
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// 从 zod 模块导入 z 对象，用于数据验证
import { z } from 'zod';
// 引入 dotenv 库，用于加载环境变量
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

const gaode = 'https://restapi.amap.com/v3/weather/weatherInfo';
const key = process.env.GAODE_KEY;

export interface Root {
  status: string;
  count: string;
  info: string;
  infocode: string;
  lives: Lfe[];
}

export interface Lfe {
  province: string;
  city: string;
  adcode: string;
  weather: string;
  temperature: string;
  winddirection: string;
  windpower: string;
  humidity: string;
  reporttime: string;
  temperature_float: string;
  humidity_float: string;
}

// 创建服务器实例
const server = new McpServer({
  // 服务器名称
  name: 'mcp-server-weather',
  // 服务器版本
  version: '1.0.0',
});

// 注册获取天气预报的工具
server.tool(
  // 工具名称
  'get-weather-forecast',
  // 工具描述
  '根据经纬度获取天气信息',
  // 工具参数
  {
    city: z.string().optional(),
  },
  // 工具的异步处理函数
  async ({ city }) => {
    // 获取网格点数据的 URL
    const pointsUrl = `${gaode}?key=${key}&city=${city}`;

    const data: Root = await fetch(pointsUrl).then((response) =>
      response.json(),
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data),
        },
      ],
    };
  },
);

// 注册github工具
server.tool(
  // 工具名称
  'get-github-user',
  // 工具描述
  '根据用户名获取 Github 用户信息',
  // 工具参数
  {
    username: z.string().optional(),
  },
  // 工具的异步处理函数
  async ({ username }) => {
    // 获取网格点数据的 URL
    const pointsUrl = `https://api.github.com/users/${username}`;
    const data: Root = await fetch(pointsUrl).then((response) =>
      response.json(),
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data),
        },
      ],
    };
  },
);

// 主函数
async function main() {
  // 创建标准输入输出服务器传输实例
  const transport = new StdioServerTransport();
  // 连接服务器
  await server.connect(transport);
  // 打印服务器运行信息
  console.error('Weather MCP Server running on stdio');
}

// 执行主函数并捕获错误
main().catch((error) => {
  // 打印致命错误信息
  console.error('Fatal error in main():', error);
  // 退出进程
  process.exit(1);
});
