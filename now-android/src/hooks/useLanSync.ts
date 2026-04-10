import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

// ─── 类型定义 ────────────────────────────────────────────────────

export interface SyncStatus {
  running: boolean;
  port: number;
  pin: string | null;
  local_ip: string | null;
}

export interface DiscoveredDevice {
  ip: string;
  name: string;
  port: number;
  lastSeen: number;
}

export type SyncPhase =
  | 'idle'
  | 'connecting'
  | 'pulling'
  | 'pushing'
  | 'applying_deletes'
  | 'done'
  | 'error';

export interface SyncProgress {
  total: number;
  synced: number;
  deleted: number;
  skipped: number;
  errors: number;
  phase: SyncPhase;
  message: string;
}

/** 本地缓存的配对会话 */
export interface PairedSession {
  ip: string;
  port: number;
  token: string;
  deviceName: string;
  pairedAt: number;
}

const STORAGE_KEY_SESSION = 'lan_sync_session';
const STORAGE_KEY_LAST_SYNC = 'lan_sync_last_sync_time';

// ─── Hook ────────────────────────────────────────────────────────

export function useLanSync() {
  const [status, setStatus] = useState<SyncStatus>({
    running: false,
    port: 27182,
    pin: null,
    local_ip: null,
  });
  const [progress, setProgress] = useState<SyncProgress>({
    total: 0,
    synced: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
    phase: 'idle',
    message: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [pairedSession, setPairedSession] = useState<PairedSession | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSION);
      return raw ? (JSON.parse(raw) as PairedSession) : null;
    } catch {
      return null;
    }
  });
  const [lastSyncTime, setLastSyncTime] = useState<number>(() => {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_SYNC);
    return raw ? Number(raw) : 0;
  });

  const pinRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 轮询服务器状态 ──────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await invoke<SyncStatus>('get_sync_status');
        setStatus(s);
      } catch {
        // 静默失败
      }
    };
    poll();
  }, []);

  // ── 持久化配对会话 ───────────────────────────────────────────────
  const savePairedSession = useCallback((session: PairedSession | null) => {
    setPairedSession(session);
    if (session) {
      localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY_SESSION);
    }
  }, []);

  const saveLastSyncTime = useCallback((ts: number) => {
    setLastSyncTime(ts);
    localStorage.setItem(STORAGE_KEY_LAST_SYNC, String(ts));
  }, []);

  // ── 启动同步服务器（本机作为服务端） ─────────────────────────────
  const startServer = useCallback(async () => {
    setIsLoading(true);
    try {
      const s = await invoke<SyncStatus>('start_sync_server');
      setStatus(s);

      // 每50秒刷新PIN（PIN有效期60秒）
      if (pinRefreshTimer.current) clearInterval(pinRefreshTimer.current);
      pinRefreshTimer.current = setInterval(async () => {
        try {
          const pin = await invoke<string>('generate_sync_pin');
          setStatus(prev => ({ ...prev, pin }));
        } catch {}
      }, 50_000);
    } catch (e) {
      console.error('start_sync_server failed:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── 停止服务器 ───────────────────────────────────────────────────
  const stopServer = useCallback(async () => {
    try {
      await invoke('stop_sync_server');
      setStatus(prev => ({ ...prev, running: false, pin: null }));
      if (pinRefreshTimer.current) {
        clearInterval(pinRefreshTimer.current);
        pinRefreshTimer.current = null;
      }
    } catch (e) {
      console.error('stop_sync_server failed:', e);
    }
  }, []);

  // ── 刷新 PIN ─────────────────────────────────────────────────────
  const refreshPin = useCallback(async () => {
    try {
      const pin = await invoke<string>('generate_sync_pin');
      setStatus(prev => ({ ...prev, pin }));
    } catch (e) {
      console.error('generate_sync_pin failed:', e);
    }
  }, []);

  // ── 设置自定义配对码 ──────────────────────────────────────────────
  const setPin = useCallback(async (pin: string) => {
    try {
      await invoke<string>('set_sync_pin', { pin });
      setStatus(prev => ({ ...prev, pin }));
    } catch (e) {
      console.error('set_sync_pin failed:', e);
      throw e;
    }
  }, []);

  // ── 配对：用 6 位 PIN 码获取 token（简化版：无需手动输入 IP）────────
  /**
   * pairWithDevice 简化版：
   * - 如果 ip 和 port 为空，则使用 discovery 发现 PC
   * - Android 作为客户端，向 PC 发起配对请求
   */
  const pairWithDevice = useCallback(async (
    targetIp: string,
    targetPort: number,
    pin: string,
    myDeviceName: string = 'Android'
  ): Promise<string | null> => {
    setProgress({ total: 0, synced: 0, deleted: 0, skipped: 0, errors: 0, phase: 'connecting', message: '正在配对...' });

    // 如果没有提供 IP/端口，说明用户想简化配对，此时 PC 端应该是服务端
    // Android 端需要先发现 PC 设备
    if (!targetIp || targetPort === 0) {
      setProgress(prev => ({ ...prev, phase: 'error', message: '请在电脑端启动同步服务，获取配对码' }));
      return null;
    }

    try {
      const url = `http://${targetIp}:${targetPort}/sync/pair`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, device_name: myDeviceName }),
      });

      if (!response.ok) throw new Error(`配对失败 HTTP ${response.status}`);

      const data = await response.json() as { token: string };
      const session: PairedSession = {
        ip: targetIp,
        port: targetPort,
        token: data.token,
        deviceName: myDeviceName,
        pairedAt: Date.now(),
      };
      savePairedSession(session);
      setProgress(prev => ({ ...prev, phase: 'idle', message: '配对成功！' }));
      return data.token;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setProgress(prev => ({ ...prev, phase: 'error', message: `配对失败: ${msg}` }));
      return null;
    }
  }, [savePairedSession]);

  // ── 清除配对会话 ─────────────────────────────────────────────────
  const unpair = useCallback(() => {
    savePairedSession(null);
    setProgress({ total: 0, synced: 0, deleted: 0, skipped: 0, errors: 0, phase: 'idle', message: '' });
  }, [savePairedSession]);

  // ── 完整双向增量同步 ─────────────────────────────────────────────
  /**
   * syncAll：
   * 1. 从对端 pull 自 lastSyncTime 以来的新增/修改 + deleted_ids
   * 2. 应用 deleted_ids（调用 Tauri db_delete_item）
   * 3. 将拉取的 items 通过 Tauri 命令写入本地
   * 4. 将本地自 lastSyncTime 以来的修改 push 到对端
   * 5. 更新 lastSyncTime
   */
  const syncAll = useCallback(async (
    libraryId: string = '',
    session?: PairedSession
  ) => {
    const s = session ?? pairedSession;
    if (!s) {
      setProgress(prev => ({ ...prev, phase: 'error', message: '未配对，请先扫描或输入对端IP并配对' }));
      return;
    }

    const { ip, port, token } = s;
    const since = lastSyncTime;

    setProgress({ total: 0, synced: 0, deleted: 0, skipped: 0, errors: 0, phase: 'pulling', message: `正在拉取自 ${since ? new Date(since).toLocaleTimeString() : '全量'} 以来的更新...` });

    try {
      // ── Step 1: Pull from remote ───────────────────────────────
      const pullUrl = `http://${ip}:${port}/sync/pull?library_id=${encodeURIComponent(libraryId)}&since=${since}`;
      const pullRes = await fetch(pullUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (pullRes.status === 401) {
        savePairedSession(null);
        setProgress(prev => ({ ...prev, phase: 'error', message: 'Token 已过期，请重新配对' }));
        return;
      }
      if (!pullRes.ok) throw new Error(`pull 失败 HTTP ${pullRes.status}`);

      const pullData = await pullRes.json() as {
        items: Record<string, unknown>[];
        total: number;
        deleted_ids: string[];
      };

      // ── Step 2: Apply remote deletes ──────────────────────────
      setProgress(prev => ({ ...prev, phase: 'applying_deletes', message: `正在应用 ${pullData.deleted_ids.length} 条删除...` }));
      let deletedCount = 0;
      for (const delId of pullData.deleted_ids) {
        try {
          await invoke('db_delete_item', { itemId: delId });
          deletedCount++;
        } catch {
          // 条目可能已经不存在，忽略
        }
      }

      // ── Step 3: Apply remote upserts via Tauri ─────────────────
      setProgress(prev => ({
        ...prev,
        phase: 'pulling',
        total: pullData.total,
        deleted: deletedCount,
        message: `正在写入 ${pullData.total} 条远程卡片...`,
      }));
      let pullSynced = 0;
      if (pullData.items.length > 0) {
        try {
          // 批量写入：调用 Tauri 命令（需要后端支持）
          await invoke('db_sync_items_from_remote', {
            itemsJson: JSON.stringify(pullData.items),
            libraryId,
          });
          pullSynced = pullData.items.length;
        } catch (e) {
          console.error('db_sync_items_from_remote failed:', e);
        }
      }

      // ── Step 4: Push local changes to remote ──────────────────
      setProgress(prev => ({ ...prev, phase: 'pushing', message: '正在读取本地变更...' }));
      let localItems: Record<string, unknown>[] = [];
      try {
        const localJson = await invoke<string>('db_get_items_since', {
          since,
          libraryId,
        });
        localItems = JSON.parse(localJson) as Record<string, unknown>[];
      } catch (e) {
        console.error('db_get_items_since failed:', e);
      }

      // 读取本地删除日志
      let localDeletedIds: string[] = [];
      try {
        localDeletedIds = await invoke<string[]>('db_get_deleted_since', { since });
      } catch {
        // 命令可能未实现，忽略
      }

      setProgress(prev => ({
        ...prev,
        total: pullData.total + localItems.length,
        message: `正在推送 ${localItems.length} 条本地变更...`,
      }));

      const pushRes = await fetch(`http://${ip}:${port}/sync/push`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: localItems,
          library_id: libraryId,
          deleted_ids: localDeletedIds,
        }),
      });

      let pushSynced = 0;
      let pushSkipped = 0;
      if (pushRes.ok) {
        const pushData = await pushRes.json() as {
          synced: number;
          skipped: number;
          deleted: number;
          errors: number;
        };
        pushSynced = pushData.synced;
        pushSkipped = pushData.skipped;
      }

      // ── Step 5: Update lastSyncTime ────────────────────────────
      const newSyncTime = Date.now();
      saveLastSyncTime(newSyncTime);

      setProgress({
        total: pullData.total + localItems.length,
        synced: pullSynced + pushSynced,
        deleted: deletedCount,
        skipped: pushSkipped,
        errors: 0,
        phase: 'done',
        message: `同步完成 ↓${pullSynced} ↑${pushSynced} 🗑${deletedCount}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setProgress(prev => ({ ...prev, phase: 'error', message: `同步失败: ${msg}` }));
    }
  }, [pairedSession, lastSyncTime, savePairedSession, saveLastSyncTime]);

  // ── 单向拉取（兼容旧逻辑） ───────────────────────────────────────
  const pullFromPC = useCallback(async (
    targetIp: string,
    targetPort: number,
    token: string,
    libraryId: string,
    since: number = 0
  ) => {
    setProgress({ total: 0, synced: 0, deleted: 0, skipped: 0, errors: 0, phase: 'pulling', message: '正在拉取数据...' });
    try {
      const url = `http://${targetIp}:${targetPort}/sync/pull?library_id=${libraryId}&since=${since}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { items: unknown[]; total: number; deleted_ids: string[] };
      setProgress({
        total: data.total,
        synced: data.total,
        deleted: data.deleted_ids?.length ?? 0,
        skipped: 0,
        errors: 0,
        phase: 'done',
        message: `成功拉取 ${data.total} 条卡片`,
      });
      return data.items;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setProgress(prev => ({ ...prev, phase: 'error', message: `拉取失败: ${msg}` }));
      return [];
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pinRefreshTimer.current) clearInterval(pinRefreshTimer.current);
    };
  }, []);

  return {
    status,
    progress,
    isLoading,
    pairedSession,
    lastSyncTime,
    startServer,
    stopServer,
    refreshPin,
    setPin,
    pullFromPC,
    pairWithDevice,
    unpair,
    syncAll,
  };
}
