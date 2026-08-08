import docker

client = docker.from_env()

# Define the GPU request
gpu_request = docker.types.DeviceRequest(
    count=-1,  # Use -1 to request all available GPUs, or specify an integer/list
    capabilities=[['gpu']]
)

# Run the container
container = client.containers.run(
    "jupyter/datascience-notebook:latest",
    device_requests=[gpu_request],
    detach=True,
    ports={'8888/tcp': 8888}
)

print("Started container with ID:", container.id)
