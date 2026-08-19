# GPU Share Hub — Production-Grade GPU Jupyter Image
# Base: NVIDIA CUDA 12.1 + cuDNN 8 Runtime on Ubuntu 22.04
# Standard: Matches RunPod / Lambda Labs / Colab environment

FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility

# 1. System packages + Tini init process + Audio/Video codecs (FFmpeg) + Sudo
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    git \
    curl \
    ca-certificates \
    ffmpeg \
    tini \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# 2. Upgrade pip & Install Jupyter + PyTorch CUDA 12.1 + Full AI/ML Ecosystem
RUN pip3 install --no-cache-dir --upgrade pip setuptools wheel && \
    pip3 install --no-cache-dir \
        notebook \
        jupyterlab \
        ipywidgets \
        torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 \
    && pip3 install --no-cache-dir \
        numpy \
        scipy \
        pandas \
        matplotlib \
        seaborn \
        scikit-learn \
        opencv-python-headless \
        tqdm \
        transformers \
        accelerate \
        datasets \
        huggingface_hub \
        einops \
    && pip cache purge

# 3. Create 'jovyan' user with passwordless sudo for user convenience
RUN useradd -m -s /bin/bash -u 1000 jovyan && \
    echo "jovyan ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/jovyan && \
    chmod 0440 /etc/sudoers.d/jovyan

# 4. Universal start-notebook.sh wrapper script
RUN echo '#!/bin/bash\nexec python3 -m notebook --ip=0.0.0.0 --port=8888 --no-browser "$@"' > /usr/local/bin/start-notebook.sh && \
    chmod +x /usr/local/bin/start-notebook.sh

USER jovyan
WORKDIR /home/jovyan

EXPOSE 8888

# Use Tini as PID 1 to prevent zombie processes from PyTorch DataLoaders
ENTRYPOINT ["tini", "-g", "--"]

CMD ["python3", "-m", "notebook", \
     "--ip=0.0.0.0", \
     "--port=8888", \
     "--no-browser", \
     "--NotebookApp.allow_remote_access=True", \
     "--NotebookApp.allow_origin=*"]
