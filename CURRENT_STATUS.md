# Proxmox VFIO GPU Passthrough 問題追蹤狀態（9/30）

## 🎯 問題摘要
MSFS 2024 在 Proxmox VFIO GPU Passthrough 環境下，運作約 1 小時後觸發遊戲暫停選單時，會發生 **VFIO reset/restore bar** 錯誤。

### 🚨 關鍵發現（9/30）
**問題發生時 GPU 裝置從 `lspci` 完全消失**
- GPU 進入 D3cold 深度睡眠後無法喚醒
- PCIe link down → 裝置從系統中完全消失
- 這是 **PCIe 電源狀態管理失效**，不是單純的驅動錯誤

---

## 🖥️ 環境資訊
- **Host**: Proxmox VE 8.4
- **CPU**: AMD Ryzen 9 9950X3D
- **GPU**: ASUS Dual RTX 4070 Ti Super OC 16G (01:00.0)
- **主機板**: ROG STRIX B650-I
- **記憶體**: 96 GB
- **VM ID**: 100 (Windows 11)

### 當前設定
```bash
# GRUB 參數（已設定）
pcie_aspm=off
pcie_aspm.policy=performance
kvm.ignore_msrs=1
amd_iommu=on
iommu=pt
nvidia-drm.modeset=0

# VFIO 設定（9/30 新增）
options vfio-pci ids=10de:2705,10de:22bb disable_idle_d3=1 nointxmask=1

# GPU 效能
GPU 利用率：97%（正常）
PCIe：16GT/s x16（正常）
```

---

## ✅ 已完成診斷（100% 排除）

### 硬體層面
- ✅ **PCIe 硬體完全正常**
  - 錯誤計數：0（DevSta: CorrErr- NonFatalErr- FatalErr-）
  - 連結速度：16GT/s x16（PCIe 4.0 全速）
  - 無 AER 錯誤記錄
  - **100% 排除 PCIe Riser 問題**

- ✅ **記憶體完全正常**
  - OCCT VRAM 測試：80% 負載 40+ 輪通過
  - memtest86+：PASS
  - GPU 97% 利用率穩定運作
  - **100% 排除 VRAM 故障**

- ✅ **系統穩定性正常**
  - hookscript 正常運作
  - 高負載測試完全穩定
  - OCCT 混合負載測試正常

### 軟體方案（已測試無效）
- ❌ Windows Registry `DisableIdlePowerManagement`（9/29 測試）
- ❌ NVIDIA Profile Inspector 電源管理設定（9/29 測試）

---

## ⏳ 當前測試狀態（9/30）

### 正在測試：disable_idle_d3 方案
**目的**：阻止 GPU 進入 D3cold 深度睡眠

**已套用設定**：
```bash
# /etc/modprobe.d/vfio.conf
options vfio-pci ids=10de:2705,10de:22bb disable_idle_d3=1 nointxmask=1
```

**監控重點**：
- lspci 是否還會消失
- VFIO reset 是否還會觸發
- 長程飛行穩定性（1.5+ 小時）

---

## 🔄 問題機制分析

```
遊戲暫停選單觸發
    ↓
GPU 電源狀態轉換：P0（全速）→ P8（閒置）→ D3cold（深度睡眠）
    ↓
VFIO 無法正確處理虛擬化環境下的電源狀態轉換
    ↓
PCIe link down
    ↓
裝置從系統消失（lspci 找不到）
    ↓
需要 PCIe rescan 才能恢復
```

---

## 📋 後續計畫

### 如果 disable_idle_d3 有效
✅ **問題解決！** → 記錄最終方案

### 如果 disable_idle_d3 無效
進行以下步驟：

1. **加入 Runtime PM 控制**
   ```bash
   # 修改 /var/lib/vz/snippets/gpu-manager.sh
   # pre-start 加入：
   echo on > /sys/bus/pci/devices/0000:01:00.0/power/control
   echo on > /sys/bus/pci/devices/0000:01:00.1/power/control
   ```

2. **測試其他遊戲**
   - 3DMark Time Spy Stress Test
   - Cyberpunk 2077 或其他 DX12 遊戲
   - 判斷是否為 MSFS 特定問題

3. **VM 層級調整**
   ```bash
   # /etc/pve/qemu-server/100.conf
   args: -cpu host,kvm=off,hv-vendor-id=1234567890ab
   ```

---

## 📊 關鍵檔案位置

```bash
# VM 設定
/etc/pve/qemu-server/100.conf

# VFIO 設定
/etc/modprobe.d/vfio.conf

# NVIDIA 黑名單
/etc/modprobe.d/nvidia-blacklist.conf

# Hookscript
/var/lib/vz/snippets/gpu-manager.sh

# GRUB 設定
/etc/default/grub
```

---

## 🔍 診斷指令

### 檢查 PCIe 裝置狀態
```bash
lspci -nn | grep -i nvidia
lspci -vvv -s 01:00.0 | grep -E "LnkSta|CorrErr"
```

### 檢查電源狀態
```bash
cat /sys/bus/pci/devices/0000:01:00.0/power/runtime_status
cat /sys/bus/pci/devices/0000:01:00.0/power/control
```

### 監控 VFIO 錯誤
```bash
dmesg -T | grep -E "vfio|BAR|reset|01:00"
```

---

## 📚 技術文件連結

- **GitHub 專案**: https://github.com/jason5545/Proxmox_xyz
- **網站**: https://jason5545.github.io/Proxmox_xyz/
- **Registry 檔案**: nvidia-disable-power-management.reg

---

## 💡 重要結論

1. **不是硬體問題**：PCIe、VRAM 都 100% 正常
2. **不是 Riser 問題**：錯誤計數 0、16GT/s x16 全速
3. **核心問題**：PCIe 電源狀態管理在虛擬化環境下的不相容
4. **解決方向**：阻止 GPU 進入深度睡眠（disable_idle_d3）
5. **測試狀態**：9/30 開始測試 disable_idle_d3，等待驗證結果

---

**最後更新**: 2025/09/30
**狀態**: 測試中（disable_idle_d3）
**下次對話請先閱讀此文件快速了解狀況**