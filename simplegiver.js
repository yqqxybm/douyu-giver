// ==UserScript==
// @name         Gemini 直播间周日自动清空荧光棒
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  每周日自动在 36252 直播间送出所有荧光棒。支持手动送礼、状态显示、自定义配置。
// @author       DouyuUser
// @match        https://www.douyu.com/36252*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    // 配置常量
    const GLOW_STICK_ID = 268;
    const ROOM_ID = 36252;

    // 获取配置 (默认: 只送荧光棒=true)
    function getConfigOnlyGlow() {
        return GM_getValue('only_glow_stick', true);
    }
    function setConfigOnlyGlow(val) {
        GM_setValue('only_glow_stick', val);
    }

    // 日志输出
    function log(msg) {
        console.log(`%c[自动送礼] ${msg}`, "color: #ff5d23; font-weight: bold;");
    }

    // UI 提示 (右上角浮动小气泡)
    function showToast(msg, type='info') {
        const id = 'dy-gift-toast';
        let el = document.getElementById(id);
        if (el) el.remove();

        el = document.createElement('div');
        el.id = id;
        let color = '#fff';
        let bg = 'rgba(0,0,0,0.8)';
        if (type === 'success') { color = '#4caf50'; }
        if (type === 'error') { color = '#f44336'; }

        el.innerHTML = `<span style="color:${color}; font-weight:bold;">[送礼助手]</span> ${msg}`;
        el.style.cssText = `
            position: fixed; top: 80px; right: 20px; z-index: 10000;
            background: ${bg}; color: white; padding: 10px 16px;
            border-radius: 8px; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            pointer-events: none; transition: opacity 0.3s;
        `;
        document.body.appendChild(el);
        setTimeout(() => { if (el) el.style.opacity = 0; }, 4000);
        setTimeout(() => { if (el) el.remove(); }, 4500);
    }

    // 检查是否是周日
    function isSunday() {
        return new Date().getDay() === 0;
    }

    // 今天的标记 Key
    function getTodayKey() {
        return `dy_sent_${new Date().toLocaleDateString()}`;
    }

    function hasSentToday() {
        return localStorage.getItem(getTodayKey()) === '1';
    }

    function markSent() {
        localStorage.setItem(getTodayKey(), '1');
    }

    // 核心送礼逻辑
    // force: 是否强制执行 (忽略周日和已送过检查)
    async function donateAll(force = false) {
        const ONLY_GLOW_STICK = getConfigOnlyGlow();

        if (!force) {
            if (!isSunday()) {
                log("今天不是周日，跳过自动送礼。");
                return;
            }
            if (hasSentToday()) {
                log("今天已完成送礼，跳过。");
                return;
            }
        }

        log("开始执行送礼流程...");
        showToast("正在检查背包...", "info");

        try {
            // 1. 获取背包
            const bagRes = await fetch(`/japi/prop/backpack/web/v1?rid=${ROOM_ID}`);
            const bagData = await bagRes.json();
            
            if (bagData.error !== 0) {
                showToast("获取背包失败: " + bagData.msg, "error");
                return;
            }

            const list = bagData.data.list || [];
            if (list.length === 0) {
                log("背包为空");
                // 即使背包为空，也标记为完成，免得一直重试
                if (!force) markSent(); 
                return;
            }

            // 2. 筛选礼物
            let targets = [];
            if (ONLY_GLOW_STICK) {
                targets = list.filter(i => i.id === GLOW_STICK_ID);
            } else {
                // 排除一些不可送的碎片 (通常 count > 0 且 type 等于某些值，这里简单判断 count)
                targets = list.filter(i => i.count > 0);
            }

            if (targets.length === 0) {
                log("没有符合条件的礼物");
                if (!force) markSent();
                return;
            }

            // 3. 逐个赠送
            let sentCount = 0;
            for (const item of targets) {
                const count = item.count;
                if (count <= 0) continue;

                log(`正在赠送: ${item.name} (${count}个)...`);
                
                const formData = new URLSearchParams();
                formData.append('propId', item.id);
                formData.append('propCount', count);
                formData.append('roomId', ROOM_ID);
                formData.append('bizExt', '{"yzxq":{}}');

                const sendRes = await fetch('/japi/prop/donate/mainsite/v1', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData
                });
                
                const sendData = await sendRes.json();
                if (sendData.error === 0) {
                    log(`✅ 成功送出 ${item.name} * ${count}`);
                    sentCount += Number(count);
                } else {
                    log(`❌ 送出失败: ${sendData.msg}`);
                }
                
                // 延时防风控
                await new Promise(r => setTimeout(r, 600));
            }

            if (sentCount > 0) {
                if (!force) markSent();
                showToast(`🎁 自动送出 ${sentCount} 个礼物！`, "success");
            } else {
                showToast("尝试送礼完成，但数量为0", "info");
            }

        } catch (e) {
            console.error(e);
            showToast("发生错误: " + e.message, "error");
        }
    }

    // 菜单功能：切换模式
    function toggleMode() {
        const current = getConfigOnlyGlow();
        const next = !current;
        setConfigOnlyGlow(next);
        
        const status = next ? "【只送荧光棒】" : "【清空所有礼物】";
        alert(`配置已更新：${status}\n\n下次运行时生效。`);
    }

    // 菜单功能：重置状态
    function resetStatus() {
        localStorage.removeItem(getTodayKey());
        alert("今日送礼状态已重置！\n刷新页面或手动执行即可再次触发送礼。");
    }

    // 注册菜单
    GM_registerMenuCommand("🚀 立即执行 (强制送礼)", () => donateAll(true));
    GM_registerMenuCommand("⚙️ 切换模式 (仅荧光棒/所有)", toggleMode);
    GM_registerMenuCommand("🔄 重置今日状态", resetStatus);

    // 自动运行
    // 延迟 5s 启动，避免刚进直播间网络拥堵
    setTimeout(() => {
        // 只有在非强制模式下，donateAll 内部才会检查周日和已送状态
        donateAll(false);
    }, 5000);

})();
