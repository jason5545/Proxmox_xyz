# 你的 LowEndTalk 討論整理報告（jason5545）

> 主題：**MSFS on Proxmox with GPU Passthrough (DXGI HANG) — $100 Bounty**

---

## 摘要（TL;DR）
- **原始問題**：在 Proxmox VE 以 VFIO 直通 RTX 4070 Ti Super 給 Windows VM 時，MSFS 2024 載入階段報 **`DXGI_ERROR_DEVICE_HUNG`**；MSFS 2020 先前測過能跑但 FPS 極差。裸機 Windows 下皆正常。
- **最終結論**：
  1) 先解決 **GPU reset / rebind** 穩定性（以 **softdep** 取代過度黑名單、搭配 **hookscript** 做 pre-start/unbind 與 post-stop/rescan/rebind）。
  2) VM 效能主因為 **Ryzen 9950X3D 的非對稱 CCD 排程**：將遊戲執行緒固定到 **V-Cache CCD**（core pinning + NUMA）。
  3) 觸發崩潰的直接因素是 **顯卡超頻**；移除後穩定。`rombar=0` 在本案**非必要**。

完成後 **GPU 利用率由 ~30% 提升至 ~97%**、VM 啟停穩定。

---

## 環境與目標
- **主機板**：ROG STRIX B650‑I  
- **CPU**：Ryzen 9 9950X3D  
- **GPU（直通）**：ASUS Dual RTX 4070 Ti Super OC 16G  
- **記憶體**：96 GB  
- **Hypervisor**：Proxmox VE 8.4（另含 PVE 9/新核心等後續註記）  
- **目標**：以 PVE 為主系統，Win11 遊戲 VM 透過 Passthrough 跑 MSFS，取代裸機 Windows。

---

## 時間線（重點事件）
- **7/24**：發起懸賞求助，說明 DXGI HANG 與環境細節。
- **8/3**：分享遠端串流顯示輸出：使用 **GLKVM** 取代實體螢幕/HDMI 假負載，便於遠端與 BIOS 存取。
- **8/6**：發佈 lm-sensors 修復報告（`nct6775 force_id=0xd802`）使風扇/溫度監控正常，並做永久化設定。
- **8/9**：發佈 **NUT 延遲關機策略**與管理腳本 `nut-delay-manager.sh`，將「斷電即關」改為「定時延後關」。
- **8/9**：音訊回饋：以 **Apollo**，聲音驅動會自動切到 **Steam Streaming**，實測無爆音。
- **8/10**：貼 **`upsc`** 量測數據（1500VA/900W，當下負載 ~17%），討論鉛酸電池壽命與放電策略。
- **9/26**：發佈 **最終整合指南**：從 Host 到 VM 的系統化優化與除錯；指出**超頻**為崩潰誘因、完成**核心綁定**與**驅動切換自動化**；GPU 利用率達 ~97%。另補 **`nvidia-drm.modeset=0`** 的說明與步驟。

---

## Host（Proxmox）層：IOMMU 與驅動管理
**GRUB 參數**（啟用 IOMMU/ACS，必要時加上 `nvidia-drm.modeset=0`）：

```bash
# /etc/default/grub
GRUB_CMDLINE_LINUX_DEFAULT="quiet amd_iommu=on iommu=pt pcie_acs_override=downstream,multifunction nvidia-drm.modeset=0"
# 套用後：
sudo update-grub && sudo reboot
```

**用 softdep 管控載入順序（取代過度黑名單）**：

```conf
# /etc/modprobe.d/vfio.conf
options vfio-pci ids=10de:2705,10de:22bb
softdep nvidia pre: vfio-pci
softdep nvidia_drm pre: vfio-pci

# /etc/modprobe.d/pve-blacklist.conf（保留為注解，避免過度黑名單）
# blacklist nvidiafb
# blacklist nouveau
# blacklist nvidia
# blacklist radeon
# blacklist amdgpu
blacklist snd_hda_codec_hdmi
```

> 變更後務必 `update-initramfs -u` 並重開機。

---

## 驅動接力自動化（Hookscript：解決 GPU Reset Bug）
**概念**：
- **pre-start**：對目標 GPU functions（視訊/音訊）設定 `driver_override=vfio-pci`；若當下已綁其他驅動則先 `unbind`；最後 `modprobe vfio-pci`。
- **post-stop**：清空 `driver_override`、如仍綁 vfio-pci 則 `unbind`，最後 **`echo 1 > /sys/bus/pci/rescan`** 觸發 PCI bus 重掃，讓主機驅動（nvidia）重新認領。

**掛載方式**：

```bash
# 儲存腳本
/var/lib/vz/snippets/gpu-manager.sh
chmod +x /var/lib/vz/snippets/gpu-manager.sh

# 套用到 VM（以 100 為例）
qm set 100 --hookscript local:snippets/gpu-manager.sh
```

> 此流程是解決 **VM 關機後無法再次啟動（pci_irq_handler Assertion）** 的關鍵。

---

## VM 層（效能）：9950X3D V‑Cache 親和性與 I/O
**CPU Core Pinning ＆ NUMA**：

```conf
# /etc/pve/qemu-server/100.conf（節錄）
affinity: 2-7,18-23
numa: 1
cores: 12
cpu: host,hidden=1
```

- 以 `lscpu -e` 與 cache 檔案判定 **V-Cache CCD** 實體核心落點，將 VM 12 核 **固定在 V‑Cache CCD**（保留 0/1 + SMT 給 Host 中斷/I/O）。
- 記憶體：建議關閉 balloon、使用 2MB hugepages；
- 磁碟：VirtIO 開 `discard=on` 與 `iothread=1`。

**`rombar=0` 的位置與結論**：
- 可避開部分 30/40 系列 ROM 相容性議題；
- 但本案實測真正的崩潰誘因是 **顯卡超頻**，移除後不須 `rombar=0` 亦穩定；
- 除錯順序：**先** 檢查超頻/溫度/驅動版本/外掛，**後** 再考慮 `rombar=0` 等低階繞法。

---

## 周邊可靠性與維運
- **GLKVM**：作為遠端「螢幕存在」來源，遠端遊玩（Sunshine/Moonlight）不必插實體螢幕，也保留進 BIOS 能力。
- **lm-sensors 修復**：`nct6775 force_id=0xd802` 讓風扇/溫度監控如常。
- **NUT 延遲關機**：以腳本實作延遲邏輯，避免短暫市電異常導致過度關閉。
- **音訊實務**：以 Apollo 讓聲音驅動自動切到 **Steam Streaming**，避免爆音。
- **UPS 能力與負載**：1500VA/實功 900W；當下負載 ~17%；採取淺循環、提早關機閾值以延壽。

---

## 黃金範本（檔案片段）
**`/etc/default/grub`**：IOMMU/ACS 與（可選）`nvidia-drm.modeset=0`。

```bash
GRUB_CMDLINE_LINUX_DEFAULT="quiet amd_iommu=on iommu=pt pcie_acs_override=downstream,multifunction nvidia-drm.modeset=0"
update-grub && reboot
```

**`/etc/modprobe.d/vfio.conf` 與 `pve-blacklist.conf`**：softdep 與精準黑名單。

```conf
options vfio-pci ids=10de:2705,10de:22bb
softdep nvidia pre: vfio-pci
softdep nvidia_drm pre: vfio-pci
# blacklist snd_hda_codec_hdmi
```

**`/var/lib/vz/snippets/gpu-manager.sh`**：pre-start / post-stop 接力。

```bash
#!/usr/bin/env bash
# 依你的 PCI 位址調整以下變數
dev_video="0000:01:00.0"
dev_audio="0000:01:00.1"

case "$1" in
  pre-start)
    for d in "$dev_video" "$dev_audio"; do
      echo vfio-pci | sudo tee /sys/bus/pci/devices/$d/driver_override >/dev/null
      if [ -e /sys/bus/pci/devices/$d/driver ]; then
        echo $d | sudo tee /sys/bus/pci/devices/$d/driver/unbind >/dev/null
      fi
    done
    sudo modprobe vfio-pci
    ;;
  post-stop)
    for d in "$dev_video" "$dev_audio"; do
      if [ -e /sys/bus/pci/devices/$d/driver ]; then
        echo $d | sudo tee /sys/bus/pci/devices/$d/driver/unbind >/dev/null
      fi
      echo "" | sudo tee /sys/bus/pci/devices/$d/driver_override >/dev/null
    done
    echo 1 | sudo tee /sys/bus/pci/rescan >/dev/null
    ;;
  *) ;;
esac
```

**`/etc/pve/qemu-server/100.conf`**（CPU 親和、NUMA、Hugepages、VirtIO I/O）：

```conf
affinity: 2-7,18-23
numa: 1
cores: 12
cpu: host,hidden=1
memory: 32768
balloon: 0
hugepages: 2
scsi0: local-lvm:vm-100-disk-0,discard=on,iothread=1
```

---

## 成果與建議
- **成果**：完成 VM 啟停穩定（解決 pci_irq_handler 相關崩潰），**GPU 利用率 ~97%**，體感接近裸機。
- **建議**：
  1) 核心/PVE 升級後，檢查 `vfio`/`modprobe` 與 **hookscript** 邏輯是否仍適用；
  2) 若再遇 DXGI/HANG 類問題，先回溯 **顯卡驅動版、超頻/溫度、遊戲內外掛** 等高階因子，再考慮 `rombar=0` 等低階繞法；
  3) 持續以 **lm-sensors**、**NUT**、**UPS** 監控運維，維持長期穩定。
