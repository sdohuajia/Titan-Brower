const axios = require('axios').default;
const WebSocket = require('ws');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const UserAgent = require('user-agents');
const chalk = require('chalk');
const moment = require('moment-timezone');
const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');

const cst = 'Asia/Shanghai'; // 北京时间 (CST, UTC+8)

class Titan {
  constructor() {
    this.BASE_API = "https://task.titannet.info/api";
    this.WS_API = "wss://task.titannet.info/api/public/webnodes/ws";
    this.VERSION = "0.0.5";
    this.LANGUAGE = "zh";
    this.BASE_HEADERS = {};
    this.WS_HEADERS = {};
    this.proxies = [];
    this.proxy_index = 0;
    this.account_proxies = {};
    this.password = {};
    this.device_ids = {};
    this.access_tokens = {};
    this.refresh_tokens = {};
    this.expires_times = {};
  }

  clearTerminal() {
    process.stdout.write('\x1Bc');
  }

  log(message) {
    console.log(
      `${chalk.cyanBright(`[ ${moment().tz(cst).format('YYYY/MM/DD HH:mm:ss z')} ]`)} ` +
      `${chalk.whiteBright('|')} ${message}`
    );
  }

  welcome() {
    console.log(
      `${chalk.greenBright('Titan节点 ')}${chalk.blueBright('自动机器人')}\n` +
      `${chalk.greenBright('ferdie ')}${chalk.yellowBright('<titan>')}`
    );
  }

  formatSeconds(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  async loadAccounts() {
    const filename = 'accounts.json';
    try {
      const data = await fs.readFile(filename, 'utf-8');
      const accounts = JSON.parse(data);
      return Array.isArray(accounts) ? accounts : [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log(`${chalk.redBright(`文件 ${filename} 未找到。`)}`);
      } else {
        this.log(`${chalk.redBright(`加载账户失败：${error.message}`)}`);
      }
      return [];
    }
  }

  async loadProxies() {
    const filename = 'proxy.txt';
    try {
      const data = await fs.readFile(filename, 'utf-8');
      this.proxies = data.split('\n').map(line => line.trim()).filter(line => line);
      if (!this.proxies.length) {
        this.log(`${chalk.redBright('未找到代理。')}`);
        return;
      }
      this.log(
        `${chalk.greenBright('代理总数：')}` +
        `${chalk.whiteBright(this.proxies.length)}`
      );
    } catch (error) {
      this.log(`${chalk.redBright(`加载代理文件失败：${error.message}`)}`);
      this.proxies = [];
    }
  }

  checkProxySchemes(proxies) {
    const schemes = ['http://', 'https://', 'socks4://', 'socks5://'];
    if (schemes.some(scheme => proxies.startsWith(scheme))) {
      return proxies;
    }
    return `http://${proxies}`;
  }

  assignProxyForAccount(account) {
    if (!this.proxies.length) return null;
    const proxy = this.checkProxySchemes(this.proxies[this.proxy_index]);
    this.account_proxies[account] = proxy;
    this.proxy_index = (this.proxy_index + 1) % this.proxies.length;
    return proxy;
  }

  buildProxyConfig(proxy = null) {
    if (!proxy) return { agent: null, proxyUrl: null };

    if (proxy.startsWith('socks')) {
      return { agent: new SocksProxyAgent(proxy), proxyUrl: null };
    } else if (proxy.startsWith('http')) {
      const match = proxy.match(/http:\/\/(.*?):(.*?)@(.*)/);
      if (match) {
        const [, username, password, hostPort] = match;
        const cleanUrl = `http://${hostPort}`;
        return { agent: new HttpsProxyAgent({ host: hostPort, auth: `${username}:${password}` }), proxyUrl: cleanUrl };
      } else {
        return { agent: new HttpsProxyAgent(proxy), proxyUrl: proxy };
      }
    }
    throw new Error('不支持的代理类型。');
  }

  generateDeviceId() {
    return randomUUID();
  }

  maskAccount(account) {
    if (account.includes('@')) {
      const [local, domain] = account.split('@');
      const masked = local.slice(0, 3) + '***' + local.slice(-3);
      return `${masked}@${domain}`;
    }
    return account.slice(0, 3) + '***' + account.slice(-3);
  }

  printMessage(account, proxy, deviceId, color, message) {
    this.log(
      `${chalk.cyanBright('[ 账户：')}` +
      `${chalk.whiteBright(this.maskAccount(account))}` +
      `${chalk.magentaBright(' - ')}` +
      `${chalk.cyanBright('代理：')}` +
      `${chalk.whiteBright(` ${proxy || '无'} `)}` +
      `${chalk.magentaBright('-')}` +
      `${chalk.cyanBright(' 设备ID：')}` +
      `${chalk.whiteBright(deviceId)}` +
      `${chalk.magentaBright(' - ')}` +
      `${chalk.cyanBright('状态：')}` +
      `${color(message)}` +
      `${chalk.cyanBright(']')}`
    );
  }

  async checkConnection(email, proxyUrl = null) {
    const { agent } = this.buildProxyConfig(proxyUrl);
    try {
      await axios.get('https://api.ipify.org?format=json', {
        httpsAgent: agent,
        timeout: 30000
      });
      return true;
    } catch (error) {
      this.printMessage(email, proxyUrl, this.device_ids[email], chalk.redBright, `连接非200 OK：${chalk.yellowBright(error.message)}`);
      return false;
    }
  }

  async authLogin(email, proxyUrl = null, retries = 5) {
    const url = `${this.BASE_API}/auth/login`;
    const data = {
      password: this.password[email],
      user_id: email
    };
    const headers = {
      ...this.BASE_HEADERS[email],
      'Content-Type': 'application/json'
    };
    const { agent } = this.buildProxyConfig(proxyUrl);

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await axios.post(url, data, {
          headers,
          httpsAgent: agent,
          timeout: 60000
        });
        return response.data;
      } catch (error) {
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        this.printMessage(email, proxyUrl, this.device_ids[email], chalk.redBright, `登录失败：${chalk.yellowBright(error.message)}`);
        return null;
      }
    }
  }

  async authRefresh(email, proxyUrl = null, retries = 5) {
    const url = `${this.BASE_API}/auth/refresh-token`;
    const data = {
      refresh_token: this.refresh_tokens[email]
    };
    const headers = {
      ...this.BASE_HEADERS[email],
      'Content-Type': 'application/json'
    };
    const { agent } = this.buildProxyConfig(proxyUrl);

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await axios.post(url, data, {
          headers,
          httpsAgent: agent,
          timeout: 60000
        });
        return response.data;
      } catch (error) {
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        this.printMessage(email, proxyUrl, this.device_ids[email], chalk.redBright, `刷新令牌失败：${chalk.yellowBright(error.message)}`);
        return null;
      }
    }
  }

  async registerWebnodes(email, proxyUrl = null, retries = 5) {
    const url = `${this.BASE_API}/webnodes/register`;
    const data = {
      ext_version: this.VERSION,
      language: this.LANGUAGE,
      user_script_enabled: true,
      device_id: this.device_ids[email],
      install_time: moment().utc().format('YYYY-MM-DDTHH:mm:ss.SSS[Z]')
    };
    const headers = {
      ...this.BASE_HEADERS[email],
      Authorization: `Bearer ${this.access_tokens[email]}`,
      'Content-Type': 'application/json'
    };
    const { agent } = this.buildProxyConfig(proxyUrl);

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await axios.post(url, data, {
          headers,
          httpsAgent: agent,
          timeout: 60000
        });
        return response.data;
      } catch (error) {
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        this.printMessage(email, proxyUrl, this.device_ids[email], chalk.redBright, `注册Webnodes失败：${chalk.yellowBright(error.message)}`);
        return null;
      }
    }
  }

  async connectWebsocket(email, useProxy) {
    let connected = false;
    while (true) {
      const proxyUrl = useProxy ? this.account_proxies[email] : null;
      const { agent } = this.buildProxyConfig(proxyUrl);
      const wssUrl = `${this.WS_API}?token=${this.access_tokens[email]}&device_id=${this.device_ids[email]}`;

      let ws;
      try {
        ws = new WebSocket(wssUrl, {
          headers: this.WS_HEADERS[email],
          agent
        });

        let heartbeatInterval;

        ws.on('open', () => {
          if (!connected) {
            this.printMessage(email, proxyUrl, this.device_ids[email], chalk.greenBright, 'WebSocket已连接');
            connected = true;
          }

          heartbeatInterval = setInterval(() => {
            ws.send(JSON.stringify({
              cmd: 1,
              echo: 'echo me',
              jobReport: {
                cfgcnt: 2,
                jobcnt: 0
              }
            }));
            this.printMessage(email, proxyUrl, this.device_ids[email], chalk.blueBright, '任务已报告');
          }, 30000);
        });

        ws.on('message', (data) => {
          const response = JSON.parse(data.toString());
          if (response.cmd === 1) {
            const todayPoint = response.userDataUpdate?.today_points || 0;
            const totalPoint = response.userDataUpdate?.total_points || 0;
            this.printMessage(
              email,
              proxyUrl,
              this.device_ids[email],
              chalk.greenBright,
              `用户数据更新 ${chalk.magentaBright('-')} 收益：${chalk.whiteBright(`今日 ${todayPoint} 点`)} ${chalk.magentaBright('-')} ${chalk.whiteBright(`总计 ${totalPoint} 点`)}`
            );
          } else if (response.cmd === 2) {
            ws.send(JSON.stringify(response));
            this.printMessage(email, proxyUrl, this.device_ids[email], chalk.greenBright, 'Echo Me 已发送');
          }
        });

        ws.on('error', (error) => {
          this.printMessage(email, proxyUrl, this.device_ids[email], chalk.redBright, `WebSocket未连接：${chalk.yellowBright(error.message)}`);
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          connected = false;
        });

        ws.on('close', () => {
          this.printMessage(email, proxyUrl, this.device_ids[email], chalk.yellowBright, 'WebSocket连接已关闭');
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          connected = false;
        });

        await new Promise(resolve => {
          ws.on('close', resolve);
          ws.on('error', resolve);
        });

        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        this.printMessage(email, proxyUrl, this.device_ids[email], chalk.redBright, `WebSocket未连接：${chalk.yellowBright(error.message)}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } finally {
        if (ws && ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
      }
    }
  }

  async processCheckConnection(email, useProxy) {
    while (true) {
      const proxy = useProxy ? this.account_proxies[email] : null;
      const isValid = await this.checkConnection(email, proxy);
      if (isValid) return true;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async processAuthLogin(email, useProxy) {
    const isValid = await this.processCheckConnection(email, useProxy);
    if (!isValid) return false;

    const proxy = useProxy ? this.account_proxies[email] : null;
    const login = await this.authLogin(email, proxy);
    if (login && login.code === 0) {
      this.access_tokens[email] = login.data.access_token;
      this.refresh_tokens[email] = login.data.refresh_token;
      this.expires_times[email] = login.data.expires_at;
      this.printMessage(email, proxy, this.device_ids[email], chalk.greenBright, '登录成功');
      return true;
    } else if (login && login.code !== 0) {
      this.printMessage(email, proxy, this.device_ids[email], chalk.redBright, `登录失败：${chalk.yellowBright(login.msg)}`);
      return false;
    }
    return false;
  }

  async processAuthRefresh(email, useProxy) {
    while (true) {
      const nowTime = Math.floor(Date.now() / 1000) + 300;
      const refreshAt = this.expires_times[email] - nowTime;
      await new Promise(resolve => setTimeout(resolve, refreshAt > 0 ? refreshAt * 1000 : 5000));

      const proxy = useProxy ? this.account_proxies[email] : null;
      const refresh = await this.authRefresh(email, proxy);
      if (refresh && refresh.code === 0) {
        this.access_tokens[email] = refresh.data.access_token;
        this.refresh_tokens[email] = refresh.data.refresh_token;
        this.expires_times[email] = refresh.data.expires_at;
        this.printMessage(email, proxy, this.device_ids[email], chalk.greenBright, '刷新令牌成功');
      } else if (refresh && refresh.code !== 0) {
        this.printMessage(email, proxy, this.device_ids[email], chalk.redBright, `刷新令牌失败：${chalk.yellowBright(refresh.msg)}`);
      }
    }
  }

  async processRegisterWebnodes(email, useProxy) {
    const proxy = useProxy ? this.account_proxies[email] : null;
    const register = await this.registerWebnodes(email, proxy);
    if (register && register.code === 0) {
      this.printMessage(email, proxy, this.device_ids[email], chalk.greenBright, '注册Webnodes成功');
      return true;
    } else if (register && register.code !== 0) {
      this.printMessage(email, proxy, this.device_ids[email], chalk.redBright, `注册Webnodes失败：${chalk.yellowBright(register.msg)}`);
    }
    return false;
  }

  async processAccounts(email, useProxy) {
    const logined = await this.processAuthLogin(email, useProxy);
    if (!logined) return;

    const registered = await this.processRegisterWebnodes(email, useProxy);
    if (!registered) return;

    await Promise.all([
      this.processAuthRefresh(email, useProxy),
      this.connectWebsocket(email, useProxy)
    ]);
  }

  async main() {
    try {
      const accounts = await this.loadAccounts();
      if (!accounts.length) {
        this.log(`${chalk.redBright('未加载到账户。')}`);
        return;
      }

      await this.loadProxies();

      // 分配代理给账户
      for (const [idx, account] of accounts.entries()) {
        const email = account.Email;
        this.account_proxies[email] = this.assignProxyForAccount(email);
      }

      this.clearTerminal();
      this.welcome();
      this.log(
        `${chalk.greenBright('账户总数：')}` +
        `${chalk.whiteBright(accounts.length)}`
      );

      this.log(`${chalk.cyanBright('=')}`.repeat(75));

      const tasks = [];
      for (const [idx, account] of accounts.entries()) {
        const email = account.Email;
        const password = account.Password;

        if (!email.includes('@') || !password) {
          this.log(
            `${chalk.cyanBright('[ 账户：')}` +
            `${chalk.whiteBright(idx + 1)}` +
            `${chalk.magentaBright(' - ')}` +
            `${chalk.cyanBright('状态：')}` +
            `${chalk.redBright(' 无效账户数据 ')}` +
            `${chalk.cyanBright(']')}`
          );
          continue;
        }

        const userAgent = new UserAgent().toString();
        this.BASE_HEADERS[email] = {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          Lang: this.LANGUAGE,
          Origin: 'https://edge.titannet.info',
          Referer: 'https://edge.titannet.info/',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'cross-site',
          'User-Agent': userAgent
        };

        this.WS_HEADERS[email] = {
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          Connection: 'Upgrade',
          Host: 'task.titannet.info',
          Origin: 'chrome-extension://flemjfpeajijmofcpgfgckfbmomdflck',
          Pragma: 'no-cache',
          'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
          'Sec-WebSocket-Key': 'g0PDYtLWQOmaBE5upOBXew==',
          'Sec-WebSocket-Version': '13',
          Upgrade: 'websocket',
          'User-Agent': userAgent
        };

        this.password[email] = password;
        this.device_ids[email] = this.generateDeviceId();

        const useProxy = !!this.account_proxies[email]; // 使用代理如果分配了代理
        tasks.push(this.processAccounts(email, useProxy));
      }

      await Promise.all(tasks);
    } catch (error) {
      this.log(`${chalk.redBright(`错误：${error.message}`)}`);
      throw error;
    }
  }
}

if (require.main === module) {
  const bot = new Titan();
  bot.main().catch(error => {
    if (error.message === 'SIGINT') {
      console.log(
        `${chalk.cyanBright(`[ ${moment().tz(cst).format('YYYY/MM/DD HH:mm:ss z')} ]`)} ` +
        `${chalk.whiteBright('|')} ` +
        `${chalk.redBright('[ 退出 ] Titan节点 - 机器人')}`
      );
    }
  });
}
