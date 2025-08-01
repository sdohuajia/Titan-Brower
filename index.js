require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { HttpsProxyAgent } = require('https-proxy-agent');
const randomUseragent = require('random-useragent');

const refreshToken = process.env.REFRESH_TOKEN;

const colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    white: "\x1b[37m",
    bold: "\x1b[1m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
};

const logger = {
    info: (msg) => console.log(`${colors.cyan}[信息] ${msg}${colors.reset}`),
    warn: (msg) => console.log(`${colors.yellow}[警告] ${msg}${colors.reset}`),
    error: (msg) => console.log(`${colors.red}[错误] ${msg}${colors.reset}`),
    success: (msg) => console.log(`${colors.green}[成功] ${msg}${colors.reset}`),
    loading: (msg) => console.log(`${colors.cyan}[加载中] ${msg}${colors.reset}`),
    step: (msg) => console.log(`${colors.white}[步骤] ${msg}${colors.reset}`),
    point: (msg) => console.log(`${colors.white}[积分] ${msg}${colors.reset}`),
    proxy: (msg) => console.log(`${colors.yellow}[代理] ${msg}${colors.reset}`),
};

function readProxies() {
    const proxyFilePath = path.join(__dirname, 'proxies.txt');
    try {
        if (fs.existsSync(proxyFilePath)) {
            const proxies = fs.readFileSync(proxyFilePath, 'utf-8')
                .split('\n')
                .map(p => p.trim())
                .filter(p => p);
            return proxies;
        }
    } catch (error) {
        logger.error(`读取 proxies.txt 文件出错: ${error.message}`);
    }
    return [];
}

class TitanNode {
    constructor(refreshToken, proxy = null) {
        this.refreshToken = refreshToken;
        this.proxy = proxy;
        this.accessToken = null;
        this.userId = null;
        this.deviceId = uuidv4();
        this.lastTodayPoints = 0; // 跟踪上一次的今日积分
        this.lastTotalPoints = 0; // 跟踪上一次的总积分

        const agent = this.proxy ? new HttpsProxyAgent(this.proxy) : null;

        this.api = axios.create({
            httpsAgent: agent,
            headers: {
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Content-Type': 'application/json',
                'User-Agent': randomUseragent.getRandom(),
            }
        });

        this.ws = null;
        this.reconnectInterval = 1000 * 60 * 5; // 5分钟重连间隔
        this.pingInterval = null;
    }

    async refreshAccessToken() {
        logger.loading('尝试刷新访问令牌...');
        try {
            const response = await this.api.post('https://task.titannet.info/api/auth/refresh-token', {
                refresh_token: this.refreshToken,
            });

            if (response.data && response.data.code === 0) {
                this.accessToken = response.data.data.access_token;
                this.userId = response.data.data.user_id;
                this.api.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
                logger.success('访问令牌刷新成功！');
                return true;
            } else {
                logger.error(`刷新令牌失败: ${response.data.msg || '未知错误'}`);
                return false;
            }
        } catch (error) {
            logger.error(`刷新访问令牌出错: ${error.message}`);
            return false;
        }
    }

    async registerNode() {
        logger.loading('正在注册节点...');
        try {
            const payload = {
                ext_version: "0.0.4",
                language: "zh",
                user_script_enabled: true,
                device_id: this.deviceId,
                install_time: new Date().toISOString(),
            };
            const response = await this.api.post('https://task.titannet.info/api/webnodes/register', payload);

            if (response.data && response.data.code === 0) {
                logger.success('节点注册成功。');
                logger.info(`初始积分: ${JSON.stringify(response.data.data)}`);
            } else {
                logger.error(`节点注册失败: ${response.data.msg || '未知错误'}`);
            }
        } catch (error) {
            logger.error(`注册节点出错: ${error.message}`);
        }
    }

    connectWebSocket() {
        logger.loading('正在连接 WebSocket...');
        const wsUrl = `wss://task.titannet.info/api/public/webnodes/ws?token=${this.accessToken}&device_id=${this.deviceId}`;

        const agent = this.proxy ? new HttpsProxyAgent(this.proxy) : null;

        this.ws = new WebSocket(wsUrl, {
            agent: agent,
            headers: {
                'User-Agent': this.api.defaults.headers['User-Agent'],
            }
        });

        this.ws.on('open', () => {
            logger.success('WebSocket 连接已建立。等待任务...');
            this.pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    const echoMessage = JSON.stringify({ cmd: 1, echo: "echo me", jobReport: { cfgcnt: 2, jobcnt: 0 } });
                    this.ws.send(echoMessage);
                }
            }, 30 * 1000);
        });

        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                if (message.cmd === 1) {
                    const response = { cmd: 2, echo: message.echo };
                    this.ws.send(JSON.stringify(response));
                }
                if (message.userDataUpdate) {
                    const { today_points, total_points } = message.userDataUpdate;
                    // 仅当今日积分或总积分增加时记录日志
                    if (today_points > this.lastTodayPoints || total_points > this.lastTotalPoints) {
                        const beijingTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                        logger.point(`北京时间 ${beijingTime} - 积分更新 - 今日: ${today_points}, 总计: ${total_points}`);
                        this.lastTodayPoints = today_points;
                        this.lastTotalPoints = total_points;
                    }
                }
            } catch (error) {
                logger.warn(`无法解析消息: ${data}`);
            }
        });

        this.ws.on('error', (error) => {
            logger.error(`WebSocket 错误: ${error.message}`);
            this.ws.close();
        });

        this.ws.on('close', () => {
            logger.warn('WebSocket 连接已关闭。尝试重新连接...');
            clearInterval(this.pingInterval);
            setTimeout(() => this.start(), this.reconnectInterval);
        });
    }

    async start() {
        if (this.proxy) {
            logger.proxy(`使用代理: ${this.proxy}`);
        } else {
            logger.proxy('以直连模式运行（无代理）');
        }
        logger.step(`使用设备 ID: ${this.deviceId}`);

        const tokenRefreshed = await this.refreshAccessToken();
        if (tokenRefreshed) {
            await this.registerNode();
            this.connectWebSocket();
        } else {
            logger.error('由于令牌刷新失败，无法启动机器人。');
        }
    }
}

function main() {
    if (!refreshToken) {
        logger.error('错误: .env 文件中未设置 REFRESH_TOKEN。');
        logger.warn('请创建 .env 文件并在其中添加您的 REFRESH_TOKEN。');
        return;
    }

    const proxies = readProxies();

    if (proxies.length > 0) {
        logger.info(`找到 ${proxies.length} 个代理。正在为每个代理启动机器人。`);
        proxies.forEach((proxy, index) => {
            setTimeout(() => {
                const bot = new TitanNode(refreshToken, proxy);
                bot.start();
            }, index * 10000);
        });
    } else {
        logger.info('proxies.txt 中未找到代理。以直连模式运行。');
        const bot = new TitanNode(refreshToken);
        bot.start();
    }
}

main();
