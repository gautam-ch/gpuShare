FROM jupyter/scipy-notebook:latest

USER root

# Pre-install PyTorch with CUDA 12.1 support + common ML/data packages
RUN pip install --no-cache-dir \
    torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 \
    && pip install --no-cache-dir \
    numpy pandas matplotlib seaborn scikit-learn \
    cupy-cuda12x \
    ipywidgets \
    && pip cache purge

USER jovyan
