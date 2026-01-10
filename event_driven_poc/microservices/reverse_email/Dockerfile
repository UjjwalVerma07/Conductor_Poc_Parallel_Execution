FROM python:3.9-slim

WORKDIR /app

# Installl curl command (needed for the bash script)

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

RUN chmod +x trigger_match.sh 
RUN chmod +x trigger_append.sh

CMD ["python", "service.py"]