#!/bin/bash

# 检查是否以 root 权限运行（用于系统包更新和安装）
if [ "$EUID" -ne 0 ]; then
    echo "警告：部分操作（如安装软件和更新系统包）需要 root 权限，尝试使用 sudo"
    SUDO="sudo"
else
    SUDO=""
fi

# 更新系统包（以 Ubuntu/Debian 为例）
echo "正在更新系统包..."
if command -v apt &> /dev/null; then
    if ! $SUDO apt update; then
        echo "错误：无法更新系统包，请检查网络或权限"
        exit 1
    fi
    if ! $SUDO apt upgrade -y; then
        echo "错误：无法升级系统包，请检查网络或权限"
        exit 1
    fi
else
    echo "错误：未检测到 apt 包管理器，当前脚本仅支持 Ubuntu/Debian 系统"
    echo "请手动安装 screen, git, nodejs, npm 或提供你的系统类型（如 CentOS）"
    exit 1
fi

# 检查并安装 screen
if ! command -v screen &> /dev/null; then
    echo "screen 未安装，正在安装..."
    if ! $SUDO apt install -y screen; then
        echo "错误：无法安装 screen，请检查网络或权限"
        exit 1
    fi
else
    echo "screen 已安装，版本: $(screen --version | head -n 1)"
fi

# 检查并安装 git
if ! command -v git &> /dev/null; then
    echo "Git 未安装，正在安装..."
    if ! $SUDO apt install -y git; then
        echo "错误：无法安装 Git，请检查网络或权限"
        exit 1
    fi
else
    echo "Git 已安装，版本: $(git --version)"
fi

# 检查并安装 nodejs 和 npm
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "Node.js 或 npm 未安装，正在安装..."
    if ! $SUDO apt install -y nodejs npm; then
        echo "错误：无法安装 Node.js 和 npm，请检查网络或权限"
        exit 1
    fi
else
    echo "Node.js 已安装，版本: $(node -v)"
    echo "npm 已安装，版本: $(npm -v)"
fi

# 更新 npm 全局包
echo "正在更新 npm 全局包..."
if ! npm update -g; then
    echo "错误：无法更新 npm 全局包，请检查网络或权限"
    exit 1
fi

# 克隆仓库
echo "正在克隆 Titan-Brower 仓库..."
if ! git clone https://github.com/sdohuajia/Titan-Brower.git; then
    echo "错误：无法克隆仓库，请检查网络或仓库地址"
    exit 1
fi

# 进入目录
echo "进入 Titan-Brower 目录..."
if ! cd Titan-Brower; then
    echo "错误：无法进入 Titan-Brower 目录"
    exit 1
fi

# 安装依赖
echo "正在安装 npm 依赖..."
if ! npm install; then
    echo "错误：npm 安装失败，请检查 package.json 或网络连接"
    exit 1
fi

# 提示用户输入代理 IP
echo "请输入代理 IP（格式：http://账号:密码@ip:端口 或 socks5://账号:密码@ip:端口），每输入一个按回车，输入完成后按 Ctrl+D 或空行回车结束："

# 清空或创建 proxy.txt 文件
> proxy.txt

# 循环读取用户输入并写入 proxy.txt
while IFS= read -r proxy; do
    # 如果输入为空行，退出循环
    [ -z "$proxy" ] && break
    # 验证代理格式（简单检查是否包含 http:// 或 socks5://）
    if [[ "$proxy" =~ ^(http://|socks5://)[^@]+@[^:]+:[0-9]+$ ]]; then
        echo "$proxy" >> proxy.txt
        echo "已添加代理：$proxy"
    else
        echo "错误：代理格式不正确（应为 http://账号:密码@ip:端口 或 socks5://账号:密码@ip:端口），跳过：$proxy"
    fi
done

# 检查是否成功写入 proxy.txt
if [ -s proxy.txt ]; then
    echo "代理已保存到 proxy.txt"
    cat proxy.txt
else
    echo "警告：proxy.txt 为空，未保存任何有效代理"
fi

# 提示用户输入 Token
echo "请输入 Token（每输入一个按回车，输入完成后按 Ctrl+D 或空行回车结束），将保存为 REFRESH_TOKEN=token 格式到 .env 文件："

# 清空或创建 .env 文件
> .env

# 计数器，用于标记 REFRESH_TOKEN 的序号
count=1

# 循环读取用户输入并写入 .env
while IFS= read -r token; do
    # 如果输入为空行，退出循环
    [ -z "$token" ] && break
    # 写入 .env 文件，格式为 REFRESH_TOKEN_1=token
    echo "REFRESH_TOKEN_$count=$token" >> .env
    echo "已添加 Token：REFRESH_TOKEN_$count=$token"
    ((count++))
done

# 检查是否成功写入 .env
if [ -s .env ]; then
    echo "Token 已保存到 .env"
    cat .env
else
    echo "警告：.env 为空，未保存任何 Token"
fi

echo "脚本执行完成！"
