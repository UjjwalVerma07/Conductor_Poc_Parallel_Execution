FROM python:3.9-slim
#It is the Debian based a lightweight linux OS

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


#Install the Linux based dependencies required for dpservices.bin
RUN apt-get update && apt-get install -y \
    libc6  \
    libstdc++6 \
    libxml2 \
    unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy application code
COPY . .


#Copy the dpservices binary Here
COPY dpservices.bin /app/dpservices.bin
RUN chmod +x /app/dpservices.bin

# Create temp directory
RUN mkdir -p /tmp/ingestion_service

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

