# GPU Share Hub — Pre-baked Jupyter Image
# Base: CUDA 12.1 runtime (ensures GPU passthrough works on any machine)
# Tag:  gpu-jupyter:latest  (auto-detected by agent.py)
#
# Build: docker build -t gpu-jupyter:latest d:\btp1\docker\
# Test:  docker run --gpus all --rm gpu-jupyter:latest nvidia-smi

FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1

# Install Python + Jupyter dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Jupyter + PyTorch CUDA 12.1 + common ML packages
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
        notebook jupyterlab \
        torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 \
    && pip3 install --no-cache-dir \
        numpy pandas matplotlib seaborn scikit-learn ipywidgets \
    && pip cache purge

# Create a non-root user for Jupyter (matches scipy-notebook behaviour)
RUN useradd -m -s /bin/bash jovyan
USER jovyan
WORKDIR /home/jovyan

EXPOSE 8888

CMD ["python3", "-m", "notebook", \
     "--ip=0.0.0.0", \
     "--port=8888", \
     "--no-browser", \
     "--NotebookApp.allow_remote_access=True"]
