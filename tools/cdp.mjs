#!/usr/bin/env node
/**
 * Minimal Chrome DevTools Protocol client (no dependencies).
 * Used by the smoke test and screenshot scripts.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      } catch (_) {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        const handlers = this.listeners.get(message.method) || [];
        handlers.forEach((handler) => handler(message.params));
      }
    });
  }

  static async connect(wsUrl) {
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 8000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(`WebSocket error: ${event.message || 'unknown'}`));
      }, { once: true });
    });
    return new CDP(socket);
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
    return this;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }

  async evaluate(expression, { awaitPromise = true } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`Page exception: ${description}`);
    }
    return result.result?.value;
  }

  async waitFor(expression, timeout = 8000, interval = 100) {
    const start = Date.now();
    let lastError = null;
    while (Date.now() - start < timeout) {
      try {
        const value = await this.evaluate(expression);
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`waitFor timed out: ${expression}${lastError ? ` — ${lastError.message}` : ''}`);
  }

  async setViewport(width = 390, height = 844, dpr = 2, mobile = true) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile,
      screenWidth: width,
      screenHeight: height,
    });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 });
    await this.send('Emulation.setUserAgentOverride', {
      userAgent: mobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
      platform: mobile ? 'iPhone' : 'Windows',
    });
  }

  async navigate(url) {
    const loaded = new Promise((resolve) => {
      const handler = () => {
        this.listeners.set('Page.loadEventFired', (this.listeners.get('Page.loadEventFired') || []).filter((fn) => fn !== handler));
        resolve();
      };
      this.on('Page.loadEventFired', handler);
    });
    await this.send('Page.navigate', { url });
    await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }

  async screenshot(filePath) {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(result.data, 'base64'));
    return filePath;
  }

  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async drag(x1, y1, x2, y2, steps = 8) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: x1 + (x2 - x1) * t,
        y: y1 + (y2 - y1) * t,
        button: 'left',
        buttons: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
  }

  close() {
    try { this.socket.close(); } catch (_) { /* ignore */ }
  }
}

export async function createPage(port = 9222, url = 'about:blank') {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Cannot create CDP page: ${response.status}`);
  const target = await response.json();
  const client = await CDP.connect(target.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await client.send('Network.enable');
  return { client, target };
}

export async function closePage(port, targetId) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
  } catch (_) { /* ignore */ }
}
