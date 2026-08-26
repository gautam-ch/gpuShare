# sitecustomize.py
import sys
import os
import threading
import time

# Chain-load any pre-existing sitecustomize.py
our_dir = os.path.dirname(__file__)
original_sys_path = list(sys.path)
if our_dir in sys.path:
    sys.path.remove(our_dir)
try:
    import sitecustomize
except ImportError:
    pass
finally:
    sys.path = original_sys_path

def configure_gpu_limits():
    vram_cap_gb_str = os.getenv("GPUSHARE_VRAM_GB")
    if not vram_cap_gb_str:
        return
    try:
        vram_cap_gb = float(vram_cap_gb_str)
    except ValueError:
        return

    def watch_imports():
        torch_configured = False
        tf_configured = False
        limit_bytes = vram_cap_gb * 1024 * 1024 * 1024
        
        # Initial telemetry file creation
        try:
            with open(f"/tmp/gpushare_usage_{os.getpid()}.json", "w") as f:
                import json
                json.dump({
                    "vram_mb": 0.0,
                    "pid": os.getpid()
                }, f)
        except Exception:
            pass

        while True:
            # Monitor PyTorch
            if 'torch' in sys.modules:
                try:
                    import torch
                    if torch.cuda.is_available():
                        if not torch_configured:
                            total_mem = torch.cuda.get_device_properties(0).total_memory
                            fraction = min(1.0, limit_bytes / total_mem)
                            torch.cuda.set_per_process_memory_fraction(fraction, 0)
                            torch_configured = True
                        
                        # Active monitoring fallback
                        allocated = torch.cuda.memory_allocated(0)
                        if allocated > limit_bytes:
                            print(f"\n[Limit Guard] 🚨 Process exceeded GPU VRAM limit! ({allocated / 1024**3:.2f} GB > {vram_cap_gb} GB Cap)", file=sys.stderr)
                            print("[Limit Guard] Terminating process...", file=sys.stderr)
                            os._exit(9)
                except Exception:
                    pass

            # Monitor TensorFlow
            if not tf_configured and 'tensorflow' in sys.modules:
                try:
                    import tensorflow as tf
                    gpus = tf.config.list_physical_devices('GPU')
                    if gpus:
                        vram_cap_mb = int(vram_cap_gb * 1024)
                        tf.config.set_logical_device_configuration(
                            gpus[0],
                            [tf.config.LogicalDeviceConfiguration(memory_limit=vram_cap_mb)]
                        )
                    tf_configured = True
                except Exception:
                    pass

            # Write telemetry file to /tmp/gpushare_usage_{pid}.json
            if 'torch' in sys.modules:
                try:
                    import torch
                    if torch.cuda.is_available():
                        allocated = torch.cuda.memory_allocated(0)
                        with open(f"/tmp/gpushare_usage_{os.getpid()}.json", "w") as f:
                            import json
                            json.dump({
                                "vram_mb": allocated / (1024**2),
                                "pid": os.getpid()
                            }, f)
                except Exception:
                    pass

            time.sleep(0.5)

    t = threading.Thread(target=watch_imports, daemon=True)
    t.start()

try:
    configure_gpu_limits()
except Exception:
    pass
