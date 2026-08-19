FROM jupyter/scipy-notebook:latest

# Tag name that agent.py auto-detects: gpu-jupyter:latest
# Build with: docker build -t gpu-jupyter:latest docker/

USER root

# Pre-install PyTorch CUDA 12.1 + common ML packages
RUN pip install --no-cache-dir \
    torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 \
    && pip install --no-cache-dir \
    numpy pandas matplotlib seaborn scikit-learn \
    ipywidgets \
    && pip cache purge

USER jovyan
