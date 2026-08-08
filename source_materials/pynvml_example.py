import pynvml

# 1. Initialize the NVML library
pynvml.nvmlInit()

try:
    # 2. Get the handle for the first GPU (index 0)
    handle = pynvml.nvmlDeviceGetHandleByIndex(0)

    # 3. Get memory information
    info = pynvml.nvmlDeviceGetMemoryInfo(handle)

    # 4. Access memory details (values are in bytes)
    print(f"Total Memory: {info.total / 1024**2:.2f} MiB")
    print(f"Used Memory:  {info.used / 1024**2:.2f} MiB")
    print(f"Free Memory:  {info.free / 1024**2:.2f} MiB")

finally:
    # 5. Always shut down NVML when finished
    pynvml.nvmlShutdown()
