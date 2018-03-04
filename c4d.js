"use strict";

var crypto = require("crypto-js");
var https = require('https');
var MongoClient = require('mongodb').MongoClient;
var signalR = require('signalr-client');
var cloudscraper = require('cloudscraper');
var WebSocket = require('ws');
var WebSocketClient = require('websocket').client;

function CryptoBot(){	
	var Settings = {};
	try{
		Settings = require('./config.json');
	}
	catch(e){
		return console.log(e);
	}
	this.balance = {}
	this.bittrexInProcess = false;
	this.bittrexProcessTime = 0;
	this.bittrexSocketConnection = Settings.Config ? Settings.Config.enabled : false;
	this.bittrexSocketStatus = false;
	this.rate = Settings.Config ? Settings.Config.polling : 60000;
	this.swingRate = Settings.Config ? Settings.Swing.rate : 60000;
	this.saneTrades = Settings.Config ? Settings.Config.saneTrades : true;
	this.liquidTrades = Settings.Config ? Settings.Config.liquidTrades : true;
	this.vibrate = Settings.Config ? Settings.Swing.swingTrade : false;
	this.viewBittrexBook = Settings.Config.viewBook;
	this.lowerLimit = Settings.Config ? Settings.Config.lowerLimit : 89;
	this.upperLimit = Settings.Config ? Settings.Config.upperLimit : 101.79;
	this.swingPercentage = Settings.Config ? Settings.Swing.swing : 0.02;
	this.logLevel = Settings.Config.logs;
	this.p1 = Settings.Config.percentage1;
	this.p2 = Settings.Config.percentage2;
	this.Settings = Settings;
	this.DB = this.database();
	//binance Settings
	this.binanceApiKey = Settings.Binance.apikey;
	this.binanceApiSecret = Settings.Binance.secretkey;
	this.binanceBalance = {account:"Binance"}	
	this.binanceB1Min = {}
	this.binanceC1Min = {}
	this.binanceU1Min = {}
	this.binanceInProcess = {}
	this.binanceOrders = {}
	this.binancePrec = {}
	this.binanceProcessTime = {}
	this.binanceKill = false;
	this.binanceSocketConnections = Settings.Binance.enabled;
	this.binanceStrategy = {}
	this.liquidTradesBinance = {}
	this.binanceTradesMade = {}
	this.binanceUserStreamStatus = false;
	for(var i=0;i< Settings.Binance.pairs.length;i++){
		this.binanceB1Min[Settings.Binance.pairs[i].pair1] = Settings.Binance.pairs[i].minimumB1;
		this.binanceC1Min[Settings.Binance.pairs[i].pair1] = Settings.Binance.pairs[i].minimumC1;
		this.binanceU1Min[Settings.Binance.pairs[i].pair1] = Settings.Binance.pairs[i].minimumU1;
		this.binanceInProcess[Settings.Binance.pairs[i].pair1] = false;
		this.binanceOrders[Settings.Binance.pairs[i].pair1] = [];
		this.binancePrec[Settings.Binance.pairs[i].pair1] = Settings.Binance.pairs[i].prec;
		this.binanceProcessTime[Settings.Binance.pairs[i].pair1] = false;
		this.binanceStrategy[Settings.Binance.pairs[i].pair1] = {one:{},two:{}}
		this.liquidTradesBinance[Settings.Binance.pairs[i].pair1] = Settings.Binance.pairs[i].liquidTrades;		
		this.binanceTradesMade[Settings.Binance.pairs[i].pair1] = false;
	}	
	//setup websocket
	this.wss = new WebSocket.Server({port:Settings.Config.port});
	//transactions
	this.Transactions = {};
}

CryptoBot.prototype.binanceAccount = function(){
	return new Promise((resolve,reject) => {	
		var date = new Date().getTime();
		var hash = crypto.SHA256(this.binanceApiSecret+"|timestamp="+date);
	    const req = https.request({
				host: "www.binance.com",
				path: '/api/v1/account?timestamp='+date+"&signature="+hash,
				method:"GET",
				headers:{
					"X-MBX-APIKEY":this.binanceApiKey,
				}
			},
			(response)=> {
	        var body = '';
	        response.on('data',(d)=> {
	            body += d;
	        });
	        response.on('end',()=> {
				var parsed;
				try{
					parsed = JSON.parse(body);
					if(parsed.code === -1021){
						throw new Error(parsed.msg);
					}
					if(!parsed.balances){
						return reject(false);
					}
					for(var i=0;i<parsed.balances.length;i++){
						this.binanceBalance[parsed.balances[i].asset.toLowerCase()] = Number(parsed.balances[i].free) > 0 ? Number(parsed.balances[i].free) : 0;
					}
					this.broadcastMessage({type:"balanceBinance",balance:this.binanceBalance});
					return resolve(this.binanceBalance);
				}
				catch(e){
					this.log("Error Getting Binance Balance:",e);
					return reject(false);
				}		
	            return resolve(Number(parsed));
	        });
	    }).on('error',(e)=>{
			return reject(e);
		})
	    req.write("");
	    req.end();
	});		
}

CryptoBot.prototype.binanceCancelOrder = function(pair,id){	
	return new Promise((resolve,reject) => {	
		var date = new Date().getTime();
		var hash = crypto.SHA256(this.binanceApiSecret+"|symbol="+pair+"&orderId="+id+"&timestamp="+date+"&recvWindow="+5000);
	    const req = https.request({
				host: "www.binance.com",
				path: '/api/v1/order?symbol='+pair+"&orderId="+id+"&timestamp="+date+"&recvWindow="+5000+"&signature="+hash,
				method:"DELETE",
				headers:{
					"X-MBX-APIKEY":this.binanceApiKey,
				}
			},
			(response)=> {
	        var body = '';
	        response.on('data',function(d){
	            body += d;
	        });
	        response.on('end',()=>{
				var parsed;
				try{
					parsed = JSON.parse(body);
					if(parsed.length < 1){
						return resolve([]);
					}
					else{
						resolve(parsed);
					}
				}
				catch(e){
					this.log("Error:",e);
					return reject(e);
				}		
	            return resolve(parsed);
	        });
	    }).on('error',(e)=>{
			return reject(e);
		});
	    req.write("");
	    req.end();
	});			
}

CryptoBot.prototype.binanceListenBeat = function(listenkey){
	return new Promise((resolve,reject) => {	
	    const req = https.request({
			host: "www.binance.com",
			path: "/api/v1/userDataStream?listenKey="+listenkey,
			method: "PUT",
			headers:{
				"X-MBX-APIKEY":this.binanceApiKey,
			}},
			(response)=> {
	        var body = '';
	        response.on('data',(d)=> {body += d;});
	        response.on('end',()=> {
				var parsed;
				try{
					parsed = JSON.parse(body);
					if(parsed.length < 1){
						return reject(false);
					}
					else{resolve(parsed)}
				}
				catch(e){
					this.log("Error:",e);
					return resolve(e);
				}		
	            return resolve(parsed);
	        });
	    }).on('error',(e)=>{
			return reject(e);
		});
	    req.write("");
	    req.end();
	});			
}

CryptoBot.prototype.binanceListenKey = function(){
	return new Promise((resolve,reject) => {	
	    const req = https.request({
				host: "www.binance.com",
				path: "/api/v1/userDataStream",
				method: "POST",
				headers:{
					"X-MBX-APIKEY":this.binanceApiKey,
				}
			},
			(response)=> {
	        var body = '';
	        response.on('data',(d)=> {
				body += d;
			});
	        response.on('end',()=> {
				var parsed;
				try{
					parsed = JSON.parse(body);
					if(!parsed.listenKey){
						return reject(false);
					}
					else{
						return resolve(parsed.listenKey);
					}
				}
				catch(e){
					this.log("Error:",e);
					return resolve(e);
				}		
	        });
	    }).on('error',(e)=>{
			return reject(e);
		});
	    req.write("");
	    req.end();
	});			
}

CryptoBot.prototype.binanceListenUser = function(){
	return new Promise((resolve,reject) => {	
		this.binanceListenKey()
		.then((key)=>{
			setInterval(()=>{
				return this.binanceListenBeat(key).catch((e)=>{
					this.log(e);
				});
			},120000);
			return resolve(this.binanceUserStream(key));
		}).catch((e)=>{
			this.log(e);
			return reject(e);
		});
	})
}

CryptoBot.prototype.binanceMonitor = function(){
	this.binanceDepth = {}
	for(var i=0;i< this.Settings.Binance.pairs.length;i++){
		this.binanceDepth[this.Settings.Binance.pairs[i].pair1] = {depth:{},strategy1:{'a%':{},'b%':{},'c%':{}},strategy2:{'a%':{},'b%':{},'c%':{}}}
		this.binanceStream(this.Settings.Binance.pairs[i].pair1,this.Settings.Binance.pairs[i].pair1);
		this.binanceStream(this.Settings.Binance.pairs[i].pair1,this.Settings.Binance.pairs[i].pair2);
		this.binanceStream(this.Settings.Binance.pairs[i].pair1,this.Settings.Binance.pairs[i].pair3);
	}	
}

CryptoBot.prototype.binanceOpenOrders = function(pair){	
	return new Promise((resolve,reject) => {	
		var date = new Date().getTime();
		var hash = crypto.SHA256(this.binanceApiSecret+"|symbol="+pair+"&timestamp="+date+"&recvWindow="+5000);
	    const req = https.request({
				host: "www.binance.com",
				path: '/api/v1/openOrders?symbol='+pair+"&timestamp="+date+"&recvWindow="+5000+"&signature="+hash,
				method:"GET",
				headers:{
					"X-MBX-APIKEY":this.binanceApiKey,
				}
			},
			(response)=> {
	        var body = '';
	        response.on('data',function(d){
	            body += d;
	        });
	        response.on('end',()=>{
				var parsed;
				try{
					parsed = JSON.parse(body);
					if(parsed.length < 1){
						return resolve([]);
					}
					else{
						resolve(parsed);
					}
				}
				catch(e){
					this.log("Error:",e);
					return reject(e);
				}		
	            return resolve(parsed);
	        });
	    }).on('error',(e)=>{
			return reject(e);
		});
	    req.write("");
	    req.end();
	});			
}

CryptoBot.prototype.binanceStream = function(base,pair){
	var client = new WebSocketClient();	
	var reset = ()=> {
		this.binanceInProcess[base] = false;
		this.binanceOrders[base] = [];
		this.binanceProcessTime[base] = 0;
		this.binanceStrategy[base] = {one:{},two:{}}		
		this.binanceTradesMade[base] = 0;
		this.broadcastMessage({type:"binanceStatus",connections:this.binanceSocketConnections.length,value:this.binanceInProcess,"time":this.binanceProcessTime,ustream:this.binanceUserStreamStatus});										
		return;
	}	
	var e1 = {}
	var b1 = {}
	var u1 = {}
	var pair1;
	var pair2;
	var pair3;
	for(var i=0;i< this.Settings.Binance.pairs.length;i++){
		if(this.Settings.Binance.pairs[i].pair1 === base){
			e1[base] = this.Settings.Binance.pairs[i].pair1.slice(0,3);
			b1[base] = this.Settings.Binance.pairs[i].pair1.slice(3,this.Settings.Binance.pairs[i].pair1.length);
			u1[base] = this.Settings.Binance.pairs[i].pair2.slice(3,this.Settings.Binance.pairs[i].pair2.length);
			pair1 = this.Settings.Binance.pairs[i].pair1;
			pair2 = this.Settings.Binance.pairs[i].pair2;
			pair3 = this.Settings.Binance.pairs[i].pair3;
			break;
		}
	}
	var solveUnder = (prec,a,b,c) => {
		var constant = c/(b*a);
		var suggested = (945/Math.pow(10,prec+1))/(Math.pow(constant,2)-constant);
		suggested = Number((suggested/c).toFixed(prec));
		return suggested;
	}
	var solveOver = (prec,prec2,a,b,c) =>{
		var constant = (a*b)/c;
		var Inc = 1/Math.pow(10,prec);
		var suggested = Number(((Inc)/(constant - 1)).toFixed(prec));
		if(suggested < this.binanceB1Min[base]){
			suggested = suggested * Math.ceil(this.binanceB1Min[base]/suggested);
			suggested = Number((suggested*b/c).toFixed(prec2))*a ; 
			suggested = Number((suggested- Inc).toFixed(prec));
		}
		return suggested
	}	
	client.on('connectFailed', (error)=> {
	    this.log(pair+ '  - Binance Connection Error: ',error,new Date());
	    return setTimeout(()=>{this.binanceStream(base,pair)},1000);
	});
	client.on('connect', (connection)=> {
	    this.log(pair+' - Binance WebSocket Client Connected:',new Date());
	    if(this.binanceSocketConnections){
			this.binanceSocketConnections.push(connection);
		}
		else{
			connection.close();
		}
	    connection.on('error', (error)=> {
	        this.log(pair+" - Connection Error: ",error,new Date());  
	    });
	    connection.on('close', ()=> {
	        this.log(pair+'- Binance Connection Closed:',new Date());
	        return setTimeout(()=>{
				if(!this.binanceKill){
					this.binanceStream(base,pair);
				}
			},1000);
	    });
	    connection.on('message', (message)=> {
			if(this.binanceInProcess[base]){return}
			if(this.binanceBalance.bnb < 0.009){return}			
			try{
		        if (message.type === 'utf8' && JSON.parse(message.utf8Data).b[0] && JSON.parse(message.utf8Data).a[0]){
		            if(pair === pair1){
						this.binanceStrategy[base]['one']['a'] = Number((Number(JSON.parse(message.utf8Data).a[0][0])).toFixed(this.binancePrec[base][0]));
						this.binanceStrategy[base]['one']['a_amount'] = Number(JSON.parse(message.utf8Data).a[0][1]);
						this.binanceStrategy[base]['two']['a'] = Number((Number(JSON.parse(message.utf8Data).b[0][0])).toFixed(this.binancePrec[base][0]));
						this.binanceStrategy[base]['two']['a_amount'] = Number(JSON.parse(message.utf8Data).b[0][1]);
						this.binanceDepth[base]['depth']['a'] = JSON.parse(message.utf8Data); 
					}
		            if(pair === pair2){
						this.binanceStrategy[base]['one']['b'] =  Number((Number(JSON.parse(message.utf8Data).a[0][0])).toFixed(this.binancePrec[base][1]));
						this.binanceStrategy[base]['one']['b_amount'] = Number(JSON.parse(message.utf8Data).a[0][1]);
						this.binanceStrategy[base]['two']['b'] = Number((Number(JSON.parse(message.utf8Data).b[0][0])).toFixed(this.binancePrec[base][1]));					
						this.binanceStrategy[base]['two']['b_amount'] = Number(JSON.parse(message.utf8Data).b[0][1]);
						this.binanceDepth[base]['depth']['b'] = JSON.parse(message.utf8Data);
					}
		            if(pair === pair3){
						this.binanceStrategy[base]['one']['c'] =  Number((Number(JSON.parse(message.utf8Data).b[0][0])).toFixed(this.binancePrec[base][2]));
						this.binanceStrategy[base]['one']['c_amount'] =  Number(JSON.parse(message.utf8Data).b[0][1]);
						var liquidC;
						var liquidCcount = 0;
						for(var i = 0;i < JSON.parse(message.utf8Data).a.length;i++){
								if(Number(JSON.parse(message.utf8Data).a[i][1] > 0.1)){
									liquidC = Number(JSON.parse(message.utf8Data).a[i][0]);
									liquidCcount = i;
									break;
								}
						}
						if(!liquidC){
							liquidC =  Number((Number(JSON.parse(message.utf8Data).a[0][0])).toFixed(this.binancePrec[base][2]));
							liquidCcount = 0;
						}
						this.binanceStrategy[base]['two']['c'] = liquidC;				
						try{
							this.binanceStrategy[base]['two']['c_amount'] = Number(JSON.parse(message.utf8Data).a[liquidCcount][1]);
						}
						catch(e){
							return this.log(e);
						}
						this.binanceDepth[base]['depth']['c'] = JSON.parse(message.utf8Data);
					}
					var _orders = {}
					var message = "Binance Bot:"
		            var percentage;
		            var profit;
		            var profit2;
		            var profit3;
		            var Transform_B1;
		            var Transform_E1;
		            var Transactions = {}
		            percentage = (this.binanceStrategy[base].one.a * this.binanceStrategy[base].one.b/this.binanceStrategy[base].one.c)*100;	
		            if(!Number(percentage)){return;}
		            if(percentage > 100){
						percentage = (this.binanceStrategy[base].two.a * this.binanceStrategy[base].two.b/this.binanceStrategy[base].two.c)*100;
						this.broadcastMessage({"type":"binancePercent","percentage":percentage,"info":this.binanceStrategy});
						if(percentage < 100.099 || percentage > 100.39){return}
						Transform_B1 = solveOver(this.binancePrec[base][4],this.binancePrec[base][3],this.binanceStrategy[base].two.a,this.binanceStrategy[base].two.b,this.binanceStrategy[base].two.c);
						Transactions[b1[base]] = Transform_B1;
						Transactions[u1[base]] = (Transactions[b1[base]] * this.binanceStrategy[base].two.b)
						Transactions[e1[base]] = Number((Transactions[u1[base]]/this.binanceStrategy[base].two.c).toFixed(this.binancePrec[base][5]));
						message += percentage.toFixed(3)+"% "+new Date().toString().split('GMT')[0]+"\n";
						message = message + Transactions[b1[base]] + " "+b1[base]+" => "+Transactions[u1[base]]+" "+u1[base]+" @" + this.binanceStrategy[base].two.b + '\n';
						message = message + (Transactions[e1[base]] * this.binanceStrategy[base].two.c) + u1[base]+" => " + Transactions[e1[base]] + " "+e1[base]+" @"+this.binanceStrategy[base].two.c +'\n'
						message = message + Transactions[e1[base]].toFixed(this.binancePrec[base][3]) + e1[base]+" => " + (Number(Transactions[e1[base]].toFixed(this.binancePrec[base][3]))*this.binanceStrategy[base].two.a).toFixed(this.binancePrec[base][0]) + " "+b1[base]+" @"+this.binanceStrategy[base].two.a +'\n';							
						if( Number((Number(Transactions[e1[base]].toFixed(this.binancePrec[base][3]))*this.binanceStrategy[base].two.a).toFixed(this.binancePrec[base][0])) >= Transform_B1 && (Transactions[e1[base]].toFixed(this.binancePrec[base][3]) <= Transactions[e1[base]])){
							this.log(message);
						}
						else{
							return this.log("Optimal Trade Not Found:",message,new Date());
						}	
						if ((Transactions[e1[base]] * this.binanceStrategy[base].two.c) < this.binanceU1Min[base]){
							return this.log("Minimum "+u1[base]+ " order not satisfied",new Date());
						}
						this.binanceInProcess[base] = true;
						this.binanceProcessTime[base] = new Date().getTime();
						this.binanceTradesMade[base] = 0;
						this.broadcastMessage({type:"binanceStatus",connections:this.binanceSocketConnections.length,value:this.binanceInProcess,"time":this.binanceProcessTime,ustream:this.binanceUserStreamStatus});										
						if(this.binanceBalance[e1[base]] > Transactions[e1[base]] && this.binanceBalance[u1[base]] > Transactions[u1[base]] && this.binanceBalance[b1[base]] > Transactions[b1[base]]){
							if(this.liquidTradesBinance[base] && (Transactions[e1[base]] < this.binanceStrategy[base].two.a_amount || Transactions[b1[base]] < this.binanceStrategy[base].two.b_amount)){
								reset();
								return this.log("Illiquid trade:",new Date());
							}
							else{
								this.binanceDepth[base]['strategy2']['c%'] = this.binanceDepth[base]['strategy2']['c%'] + "(Possible Illiquid Trade)";
							}
							//this.notify(message + "\r\n" + JSON.stringify(this.binanceDepth[base]).replace(new RegExp('"', 'g'),""));
							this.notify(message);
							Promise.all([
							this.binanceTrade(pair2.toUpperCase(),"SELL",Transactions[b1[base]],this.binanceStrategy[base].two.b,"GTC"),
							this.binanceTrade(pair3.toUpperCase(),"BUY",Transactions[e1[base]],this.binanceStrategy[base].two.c,"GTC"),
							this.binanceTrade(pair1.toUpperCase(),"SELL",Number(Transactions[e1[base]].toFixed(this.binancePrec[base][3])),this.binanceStrategy[base].two.a,"GTC")]).then((values)=>{
								_orders[values[0].clientOrderId] = false;
								_orders[values[1].clientOrderId] = false;
								_orders[values[2].clientOrderId] = false;
								profit = Number((Number(Transactions[e1[base]].toFixed(this.binancePrec[base][3]))*this.binanceStrategy[base].two.a).toFixed(this.binancePrec[base][4])) - Transactions[b1[base]];
								profit2 = Transactions[e1[base]] - Number(Transactions[e1[base]].toFixed(this.binancePrec[base][3]));
								profit3 = Transactions[u1[base]] - (Transactions[e1[base]] * this.binanceStrategy[base].two.c);
								this.saveDB("trade",{},{extra:{"w":1,"upsert":true},method:"update",query:{"Time":this.binanceProcessTime[base]},modifier:{"$set":{"Time":this.binanceProcessTime[base],"Percent":percentage,"Exchange":"Binance","Profit":profit,"Profit2":profit2,"Profit3":profit3,"Pair":base}}});
								return setTimeout(()=>{
									this.log("Checking:",Object.keys(_orders),new Date());
									if((new Date().getTime() - this.binanceProcessTime[base]) > 480000 && this.binanceInProcess[base] === true) {
										this.log("Binance Arbitrage timeout.....",new Date());
										return reset();
									}
								},480005)
							}).catch((e)=>{
								reset();
								this.log("Error:",e,new Date());
								return this.notify(e.toString());
							});
						}
						else{
							this.log("Wallet balance low:",new Date());
							return reset();
						}
					}
		            else{
						this.broadcastMessage({"type":"binancePercent","percentage":percentage,"info":this.binanceStrategy});		
						if(percentage < 99.5 || percentage > 99.92){return}					
						Transform_E1 = solveUnder(this.binancePrec[base][3],this.binanceStrategy[base].one.a,this.binanceStrategy[base].one.b,this.binanceStrategy[base].one.c);
						Transactions[e1[base]] = Transform_E1;					
						Transactions[u1[base]] = this.binanceStrategy[base].one.c * Transactions[e1[base]];
						Transactions[b1[base]] = Number((Transactions[u1[base]]/this.binanceStrategy[base].one.b).toFixed(this.binancePrec[base][4]))			
						message += percentage.toFixed(3)+"% "+new Date().toString().split('GMT')[0]+"\n";
						message = message + Transactions[e1[base]] + e1[base]+" => "+Transactions[u1[base]]+" "+u1[base]+" @" + this.binanceStrategy[base].one.c + '\n';
						message = message + (Transactions[b1[base]] * this.binanceStrategy[base].one.b) + u1[base]+" => " + Transactions[b1[base]] + " "+b1[base]+" @"+this.binanceStrategy[base].one.b +'\n'
						message = message + (Transform_E1 * this.binanceStrategy[base].one.a).toFixed(8) + b1[base]+" => " + (Transactions[b1[base]]/this.binanceStrategy[base].one.a).toFixed(this.binancePrec[base][3]) + " "+e1[base]+" @"+this.binanceStrategy[base].one.a +'\n';		
						if((Transactions[b1[base]] >= (Number((Transactions[b1[base]]/this.binanceStrategy[base].one.a).toFixed(this.binancePrec[base][3])) * this.binanceStrategy[base].one.a)) && (Number((Transactions[b1[base]]/this.binanceStrategy[base].one.a).toFixed(this.binancePrec[base][3])) >= Transactions[e1[base]]) && ((Transactions[u1[base]] - (Transactions[b1[base]] * this.binanceStrategy[base].one.b)) > 0) ){
							this.log(message);
						}
						else{
							return this.log("Optimal Trade Not Found:",message,new Date());
						}	
						if ((Transactions[e1[base]] * this.binanceStrategy[base].two.c) < this.binanceU1Min[base]){
							return this.log("Minimum "+u1[base]+ " order not satisfied",new Date());
						}	
						if (Transactions[b1[base]] < this.binanceB1Min[base]){
							return this.log("Minimum "+b1[base]+ " order not satisfied",new Date());
						}
						this.binanceInProcess[base] = true;
						this.binanceProcessTime[base] = new Date().getTime();
						this.binanceTradesMade[base] = 0;
						this.broadcastMessage({type:"binanceStatus",connections:this.binanceSocketConnections.length,value:this.binanceInProcess,"time":this.binanceProcessTime,ustream:this.binanceUserStreamStatus});										
						if(this.binanceBalance[e1[base]] > Transactions[e1[base]] && this.binanceBalance[b1[base]] > Transactions[b1[base]] && this.binanceBalance[u1[base]] > Transactions[u1[base]]){
							if(this.liquidTradesBinance[base] && (Transactions[e1[base]] < this.binanceStrategy[base].one.a_amount || Transactions[b1[base]] < this.binanceStrategy[base].one.b_amount)){
								reset();
								return this.log("Illiquid trade:",message);
							}
							else{
								this.binanceDepth[base]['strategy1']['c%'] = this.binanceDepth[base]['strategy1']['c%'] + "\n Illiquid Trade";
							}
							this.notify(message);
							Promise.all([this.binanceTrade(pair3.toUpperCase(),"SELL",Transactions[e1[base]],this.binanceStrategy[base].one.c,"GTC"),this.binanceTrade(pair2.toUpperCase(),"BUY",Transactions[b1[base]],this.binanceStrategy[base].one.b,"GTC"),this.binanceTrade(pair1.toUpperCase(),"BUY",(Transactions[b1[base]]/this.binanceStrategy[base].one.a).toFixed(this.binancePrec[base][3]),this.binanceStrategy[base].one.a,"GTC")]).then((values)=>{
								_orders[values[0].clientOrderId] = false;
								_orders[values[1].clientOrderId] = false;
								_orders[values[2].clientOrderId] = false;
								profit = Number((Transactions[b1[base]]/this.binanceStrategy[base].one.a).toFixed(this.binancePrec[base][3])) - Transactions[e1[base]];
								profit2 = Transactions[b1[base]] - (Transactions[e1[base]] * this.binanceStrategy[base].one.a);
								profit3 = Transactions[u1[base]] - (Transactions[b1[base]] * this.binanceStrategy[base].one.b);
								this.saveDB("trade",{},{extra:{"w":1,"upsert":true},method:"update",query:{"Time":this.binanceProcessTime[base]},modifier:{"$set":{"Time":this.binanceProcessTime[base],"Percent":percentage,"Exchange":"Binance","Profit":profit,"Profit2":profit2,"Profit3":profit3,"Pair":base}}});								
								return setTimeout(()=>{
									this.log("Checking:",Object.keys(_orders),new Date());
									if((new Date().getTime() - this.binanceProcessTime[base]) > 480000 && this.binanceInProcess[base] === true) {
										this.log("Binance Arbitrage timeout.....",new Date());
										return reset();
									}
								},480005)
							}).catch((e)=>{
								reset();
								this.log("Error:",e,new Date());
								return this.notify(e.toString());
							});
						}
						else{
							this.log("Wallet Balance Low:",new Date());
							return reset();
						}
					}
				}
			}
			 catch(e){
				return this.log(e);
	        }
	    });
	    
	});		
	client.connect('wss://stream.binance.com:9443/ws/'+pair+'@depth');
	return client;
}

CryptoBot.prototype.binanceUserStream = function(key){
	var client = new WebSocketClient();		
	var pairs ={}
	for(var i=0;i< this.Settings.Binance.pairs.length;i++){
		pairs[this.Settings.Binance.pairs[i].pair1] = [this.Settings.Binance.pairs[i].pair1,this.Settings.Binance.pairs[i].pair2,this.Settings.Binance.pairs[i].pair3];
	}	 
	client.on('connectFailed', (error)=> {
	    this.log('Binance User Account Connect Error: ' + error.toString());
	    this.binanceUserStreamStatus = false;
		this.broadcastMessage({type:"binanceStatus",connections:this.binanceSocketConnections.length,value:this.binanceInProcess,"time":this.binanceProcessTime,ustream:this.binanceUserStreamStatus});										
	});
	client.on('connect', (connection)=> {
	    this.log('WebSocket Client Connected:Listening to Binance User Account:',new Date());
	    this.binanceUserStreamStatus = true;
	    this.broadcastMessage({type:"binanceStatus",connections:this.binanceSocketConnections.length,value:this.binanceInProcess,"time":this.binanceProcessTime,ustream:this.binanceUserStreamStatus});										
	    connection.on('error', (error)=> {
	        this.log("Binance User Account Connection Error:",error);
	        this.binanceUserStreamStatus = false;
	        this.broadcastMessage({type:"binanceStatus",connections:this.binanceSocketConnections.length,value:this.binanceInProcess,"time":this.binanceProcessTime,ustream:this.binanceUserStreamStatus});										
	    });
	    connection.on('close', ()=> {
	        this.log('User Account Connection Closed:',new Date());
	        this.binanceUserStreamStatus = false;
			this.broadcastMessage({type:"binanceStatus",connections:this.binanceSocketConnections.length,value:this.binanceInProcess,"time":this.binanceProcessTime,ustream:this.binanceUserStreamStatus});										
	        return setTimeout(()=>{this.binanceUserStream(key)},10000);
	    });
	    connection.on('message', (message)=> {
	        if (message.type === 'utf8') {
				var base;
	            var data;
	            try{
					 data = JSON.parse(message.utf8Data);
					 if(data.e == "executionReport"){
						if(data.x == "NEW"){
							for(key in pairs){
								if(pairs[key].indexOf(data.s.toLowerCase()) > -1){
									base = key;
									break;
								}
							}
							if(this.binanceOrders[base] && this.binanceInProcess[base]){
								var _key= "Orders."+data.c;
								var _set = {}
								_set[_key] = false;
								this.saveDB("trade",{},{extra:{"w":1,"upsert":true},method:"update",query:{"Time":this.binanceProcessTime[base]},modifier:{"$set":_set}});
								this.binanceOrders[base].push(data.c);
								this.binanceTradesMade[base]++;
								var order = {type:"order","exchange":"Binance","otype":data.S,"order_id":data.c,"amount":data.q,"pair":data.s,"status":data.x,"rate":data.p,"timestamp_created":data.E}
								this.broadcastMessage(order);
								this.log("Binance Order Added:",data.c,new Date());
							}
						}
						if(data.x == "CANCELED" || data.X === "FILLED"){
							for(key in pairs){
								if(pairs[key].indexOf(data.s.toLowerCase()) > -1){
									base = key;
									break;
								}
							}
							if(this.binanceOrders[base] && this.binanceInProcess[base]){
								var key= "Orders."+data.c;
								var update = {key:true}
								var lookupOrder = {}
								var _set = {}
								lookupOrder[key] = false;
								_set[key] = true;
								_set['Filled'] = new Date().getTime();
								this.saveDB("trade",{},{extra:{"w":1},method:"update",query:lookupOrder,modifier:{"$set":_set,"$inc":{"OrdersFilled":1}}});
								if(this.binanceOrders[base].indexOf(data.c) > -1){
									if(this.binanceOrders[base][0] === data.c){
										this.binanceOrders[base].shift();
									}
									else if(this.binanceOrders[base][this.binanceOrders[base].length - 1] === data.c){
										this.binanceOrders[base].pop();
									}
									else{
										this.binanceOrders[base] = [this.binanceOrders[base][0],this.binanceOrders[base][2]];
									}
								}
								this.log("Binance Order Removed:",data.c,new Date().toString()+":"+this.binanceOrders[base].length+"/"+this.binanceTradesMade[base]);
								this.broadcastMessage({type:"orderRemove",order_id:data.c});
								if(this.binanceOrders[base].length === 0 && this.binanceTradesMade[base] === 3){
									this.binanceStrategy[base] = {one:{},two:{}}
									this.binanceTradesMade[base] = false;
									this.binanceInProcess[base] = false;	
									this.binanceProcessTime[base] = 0;	
									this.broadcastMessage({type:"binanceStatus",connections:this.binanceSocketConnections.length,value:this.binanceInProcess,"time":this.binanceProcessTime,ustream:this.binanceUserStreamStatus});										
								}
							} 
						}
					}
					else if(data.e === "outboundAccountInfo"){
						for(var i=0;i<data.B.length;i++){
							this.binanceBalance[data.B[i].a.toLowerCase()] = Number(data.B[i].f) > 0 ? Number(data.B[i].f) : 0;
						}
						this.broadcastMessage({type:"balanceBinance",balance:this.binanceBalance});
					}									
				}
				catch(e){
					return this.log("Error:",e);
				}
	        }
	    });
	});		
	client.connect('wss://stream.binance.com:9443/ws/'+key);
	return client;
}	

CryptoBot.prototype.binanceTrade = function(pair,side,amount,price,timeInForce){
	return new Promise((resolve,reject) => {	
		var date = new Date().getTime();
		var hash = crypto.SHA256(this.binanceApiSecret+"|symbol="+pair+"&timestamp="+date+"&timeInForce="+timeInForce+"&side="+side+"&type=LIMIT&quantity="+amount+"&price="+price+"&recvWindow="+6000);
	    const req = https.request({
				host: "www.binance.com",
				path: '/api/v1/order?symbol='+pair+"&timestamp="+date+"&timeInForce="+timeInForce+"&side="+side+"&type=LIMIT&quantity="+amount+"&price="+price+"&recvWindow="+6000+"&signature="+hash,
				method:"POST",
				headers:{
					"X-MBX-APIKEY":this.binanceApiKey,
				}
			},
			(response)=> {
	        var body = '';
	        response.on('data',function(d) {
	            body += d;
	        });
	        response.on('end',()=> {
				var parsed;
				try{
					parsed = JSON.parse(body);
					if(!parsed.orderId){
						this.notify("Error trading:"+pair+","+side+","+amount+","+price+","+new Date().toString());
						this.log("Error trading:",pair,side,amount,price,new Date());
						return reject(false);
					}
					else{
						return resolve(parsed);
					}
				}
				catch(e){
					this.log("Error:",e);
					return reject(e);
				}		
	            return resolve(parsed);
	        });
	    }).on('error',(e)=>{
			return reject(e);
		})
	    req.write("");
	    req.end();
	});					
}

CryptoBot.prototype.bittrexAPI = function(path,options){
	return new Promise((resolve,reject) =>{	
		var hmac;
		var nonce;
		var postData;
		var req;
		var shaObj;
		nonce = Math.floor(new Date().getTime()/1000);
		postData ="https://bittrex.com/api/v1.1/"+path+"?apikey="+this.Settings.Bittrex.apikey+"&nonce="+nonce;
		if(options && options.length > 0){
			postData = postData + options;
		}
		hmac = crypto.HmacSHA512(postData,this.Settings.Bittrex.secret).toString();
		req = https.request(
		    {
				host:"bittrex.com",
				path:postData.replace("https://bittrex.com",""),
				method:"Get",
				headers:{"apisign":hmac}
			},
			(response)=>{
		        var body = "";
		        response.on("data",(d)=>{
					body += d;
				});
		        response.on("end",()=>{
					var parsed;
					try{
						parsed = JSON.parse(body);
						return resolve(parsed.result);		
					}
					catch(e){
						this.log("Body:",body,new Date());
						this.log("Bittrex API Error:",e);
						return reject(e);
					}		
		            return resolve(parsed);
			    });
		        response.on('error',(e)=>{
					this.log("Bittrex API Error => ",e,new Date());
					return reject(e);
				})
			}
	    );
	   return req.end();
	});
}	
	
CryptoBot.prototype.bittrexAccount = function(){
	return new Promise((resolve,reject)=>{
		return this.bittrexAPI("account/getbalances",null).then((list)=>{
			if(!list){
				this.log("Error getting Bittrex account info");
				return reject(false);
			}
			list.forEach((asset)=>{
				return this.balance[asset.Currency.toLowerCase()] = asset.Available;
			});
			this.balance.account = "BITTREX";
			this.broadcastMessage({"type":"balance","balance":this.balance,"p1":this.p1,"p2":this.p2});
			var balance = {};
			for(var i = 0;i < list.length;i++){
				if(this.balance[list[i].Currency.toLowerCase()] > 0){
					balance[list[i].Currency] = this.balance[list[i].Currency.toLowerCase()];
				}
			}		
			return resolve(true);				
		}).catch((e)=>{
			this.log("Error getting bittrex balance:",e);
			return reject(false);
		});
	});
}
	
CryptoBot.prototype.bittrexCancelOrder = function(orderid){
	return new Promise((resolve,reject)=>{
		return this.bittrexAPI("market/cancel","&uuid="+orderid).then((res)=>{
			if(!res.success){
				this.log("Error Canceling Bittrex Order:",orderid);
				return reject(false);
			}	
			return resolve(res);				
		}).catch((e)=>{
			this.log("Error Canceling Bittrex Order:",e,orderid);
			return reject(false);
		});
	});
}	
	
CryptoBot.prototype.bittrexCompleteArbitrage = function(tracking){
	if(Object.keys(tracking).length === 0 && obj.constructor === Object){
		this.rate = 52000;
		this.broadcastMessage({"type":"poll_rate","polling":this.rate});
		return setTimeout(()=>{
			this.bittrexAccount();
			this.rate = this.Settings.Config.polling;
			this.bittrexInProcess = false;
			this.bittrexProcessTime = 0;
			this.broadcastMessage({type:"bittrexStatus",value:this.bittrexInProcess,time:this.bittrexProcessTime,wsStatus:this.bittrexSocketStatus});
		},52000);
	}
	this.log("Monitoring Orders: ",tracking,new Date(),this.rate);
	var _checkFilled = (uuid) => {
		this.bittrexAPI("account/getorder","&uuid="+uuid).then((order)=>{
			if(order){
				if(order.IsOpen !== true){
					tracking[uuid] = true;
					this.log("Bittrex order removed:",uuid,tracking);
					this.broadcastMessage({type:"orderRemove",order_id:uuid});
					var key= "Orders."+uuid;
					var lookupOrder = {}
					lookupOrder[key] = false;
					try{
						this.saveDB("trade",{},{extra:{"w":1},method:"update",query:lookupOrder,modifier:{"$set":{"Orders":tracking},"$inc":{"OrdersFilled":1}}});	
					}
					catch(e){
						this.log(e);
					}							
					this.bittrexAccount().catch((e)=>{
						this.log(e);
					});
					
				}		
			}
			else{
				this.log("Unable to find order while completing arbitrage:"+uuid);
			}
		}).catch((e)=>{
				this.log(e);
			});	
	}
	var count = 0;
	for(var key in tracking){
		if(tracking[key] === false){
			_checkFilled(key);
		}
		else{
			count++;
		}
	}
	if(count !== 3 && this.rate < 1400000){
		this.rate = this.rate * 2.3;
		this.broadcastMessage({"type":"poll_rate","polling":this.rate});
		return setTimeout(()=>{return this.bittrexCompleteArbitrage(tracking);},this.rate);
	}
	else{
		this.log("Arbitrage Completed");
		this.broadcastMessage({"type":"alert","alert":"Arbitage Completed","polling":this.rate});
		return this.bittrexAccount().then(()=>{
			this.rate = this.Settings.Config.polling;
			this.bittrexInProcess = false;
			this.bittrexProcessTime = 0;
			this.broadcastMessage({type:"bittrexStatus",value:this.bittrexInProcess,time:this.bittrexProcessTime,wsStatus:this.bittrexSocketStatus});	
		}).catch((e)=>{
			this.log("Error Getting Balance:",e);
			this.notify(e.toString()+"\nError getting balance after arbitrage completed:"+new Date());
			return this.bittrexAccount().then(()=>{
				this.bittrexInProcess = false;
				this.bittrexProcessTime = 0;
				this.broadcastMessage({type:"bittrexStatus",value:this.bittrexInProcess,time:this.bittrexProcessTime,wsStatus:this.bittrexSocketStatus});
			}).catch((e)=>{
				this.bittrexInProcess = false;
				this.bittrexProcessTime = 0;
				this.broadcastMessage({type:"bittrexStatus",value:this.bittrexInProcess,time:this.bittrexProcessTime,wsStatus:this.bittrexSocketStatus});
			});
		})
	}	
}	

CryptoBot.prototype.bittrexDepthPure = function(pair){
	return new Promise((resolve,reject) =>{	
	    https.get({host: "bittrex.com",path: "/api/v1.1/public/getorderbook?market="+pair+"&type=both"},(response)=>{
		        var body = '';
		        response.on('data',(d)=> {
					body += d;
				});
		        response.on('end',()=> {	
						try{
							if(!body){
								return reject(body);
							}
				            var parsed = JSON.parse(body);
				            if(!parsed || !parsed.success){
								return reject("Error:"+body);
							}
							return resolve({"sell":Number(parsed['result'].sell[0].Rate),"buy":Number(parsed['result'].buy[0].Rate)});
						}
						catch(e){
							return reject(false);
						}
			    });
		}).on('error',(e)=>{
			this.log(e);
			return reject(e);
		});
	});
}

CryptoBot.prototype.bittrexGetOrders = function(){
	return new Promise((resolve,reject) => {	
		return this.bittrexAPI("market/getopenorders",null).then((orders)=>{
			if(orders && orders.length > 0){
				for(var i = 0;i < orders.length;i++){
					this.saveDB("order",{},{extra:{"w":1},method:"update",query:{"uuid":orders[i].OrderUuid},modifier:{"$set":{"open":true}}});
				}
			}
			return resolve(orders);
		}).catch((e)=>{
			this.log(e);return reject(e);
		});	
	})
}	

CryptoBot.prototype.bittrexPrepareStream = function(){
	return new Promise((resolve,reject) =>{	
		cloudscraper.get('https://bittrex.com/',(error,response,body)=> {
				if (error) {
					this.log('Cloudscraper error occurred');
					return reject(error);
				} 
				else{  
					this.log('CloudFlare bypassed:',new Date());
					return resolve([response.request.headers["cookie"],response.request.headers["User-Agent"]]);
				}
			});
	});
}

CryptoBot.prototype.bittrexStream = function(cookie,agent){
	var a;
	var b;
	var c;
	var client;
	var data;
	var liquidBook;
	var localMarket = {}
	var message = "Bittrex Bot:";
	var myWallet;
	var n;
	var orders = {}
	var pair;
	var pair1 = this.Settings.Config.pair1;
	var pair2 = this.Settings.Config.pair2;
	var pair3 = this.Settings.Config.pair3;
	var percentage;
	var sanity;
	var strategy = {};	
	var trading_pairs;
	var Transactions = this.Transactions;
	var e1;
	var _e1;
	var u2;
	var b3;
	var _b3;
	e1 = pair1.split('-')[1].toLowerCase();
	_e1 = "_" + pair1.split('-')[1].toLowerCase();
	b3 = pair1.split('-')[0].toLowerCase();
	_b3 = "_"+pair1.split('-')[0].toLowerCase();
	u2 = pair2.split('-')[0].toLowerCase();		
	localMarket[this.Settings.Config.pair1] = {Bids:{},Asks:{}}
	localMarket[this.Settings.Config.pair2] = {Bids:{},Asks:{}}
	localMarket[this.Settings.Config.pair3] = {Bids:{},Asks:{}}
	strategy[this.Settings.Config.pair1] = {}
	strategy[this.Settings.Config.pair2] = {}
	strategy[this.Settings.Config.pair3] = {}	
	function BubbleSort(array,limitHigh){
		var temp;
		for(var j=0;j<array.length;j++){
			for(var i=0;i < array.length;i++){
				if(array[i+1] && Number(array[i]) < Number(array[i+1])){
					temp = array[i];
					array[i] = array[i+1];
					array[i+1] = temp;
				}
			}
		}
		if(limitHigh){
			var narray = [];
			array.forEach(function(v,i){
				if((Number(v) < limitHigh * 1.035) && (0.9907 * limitHigh < Number(v))){
					narray.push(v);
				}
			});
			array = narray
		}
		return array
	}			

	var reset = () => {
		this.bittrexInProcess = false;	
		this.bittrexProcessTime = 0;
		this.broadcastMessage({type:"bittrexStatus",value:this.bittrexInProcess,time:this.bittrexProcessTime,wsStatus:this.bittrexSocketStatus});
		return;
	}
	
	var sortBook = (obj) =>{
		var keys1 = Object.keys(obj["Asks"]);
		var keys2 = Object.keys(obj["Bids"]);
		keys2 = BubbleSort(keys2);
		keys1 = BubbleSort(keys1,Number(keys2[0]));
		if(keys1.length > 25){
			for(var i = 0;i < 5;i++){
				delete obj["Asks"][keys1[i]];
			}
			keys1 = keys1.slice(5);
		}
		if(keys2.length > 25){
			for(var i = 20;i < 25;i++){
				delete obj["Bids"][keys2[i]];
			}
			keys2 = keys2.slice(0,20);
		}	
		obj["Sorted"] = [keys1,keys2];
	}
	var subscribeToMarkets = () => {
		[this.Settings.Config.pair1,this.Settings.Config.pair2,this.Settings.Config.pair3].forEach((market)=> {	
		client.call('CoreHub', 'SubscribeToExchangeDeltas', market).done((err, result)=> {
			if (result === true) {
				this.log('Subscribed to Bittrex market:' + market);
			}
		});
		});
	};
	var updateMarket = (pair,data)=>{
		var rate;
		for(var i = 0; i< data.Buys.length;i++){
			rate = data.Buys[i].Rate.toString();
			if(data.Buys[i].Type === 0 || data.Buys[i].Type === 2){
				localMarket[pair]["Bids"][rate] = data.Buys[i].Quantity;
			}
			else{
				delete localMarket[pair]["Bids"][rate];
			}
		}
		for(var i = 0; i< data.Sells.length;i++){
			rate = data.Sells[i].Rate.toString();
			if(data.Sells[i].Type === 0 || data.Sells[i].Type === 2){
				localMarket[pair]["Asks"][rate] = data.Sells[i].Quantity;
			}
			else{
				delete localMarket[pair]["Asks"][rate];
			}
		}	
		return sortBook(localMarket[pair]);
	}
	client = new signalR.client("wss://socket.bittrex.com/signalr",['CoreHub']);	
	client.headers['User-Agent'] = agent;
	client.headers['cookie'] = cookie;
	client.serviceHandlers = {
			bound: ()=> { 
			this.log("Bittrex Websocket bound"); 
		},
		connectFailed: (error)=> { 
			this.log("Bittrex Websocket connectFailed: ", error); 
			this.updateBittrexSocketStatus(false);
		},
		connected: (connection)=> {
			subscribeToMarkets();
			this.bittrexSocketConnection = connection;
			this.log("Bittrex Websocket connected:",new Date()); 
			this.updateBittrexSocketStatus(true);
			setTimeout(()=>{
				if(this.bittrexSocketConnection){
					this.log("Resetting Bittrex Connection:",new Date())
					this.bittrexSocketConnection.close();
					return this.bittrexStream(cookie,agent);
				}
			},1800000);
		},
		disconnected: ()=> { 
			this.log("Bittrex Websocket disconnected:",new Date()); 
			return this.updateBittrexSocketStatus(false);
		},
		onerror:(error)=> { 
			this.log("Bittrex Websocket onerror: ", error); 
			this.updateBittrexSocketStatus(false);
			return this.bittrexPrepareStream().then((info2)=>{
				this.bittrexStream(info2[0],info2[1])
			}).catch((e)=>{
				this.log("Error connecting to Bittrex Websocket:",new Date());
			});
			
		},
		messageReceived: (message)=> {
			if(this.bittrexInProcess === true){
				return;
			}
			try{
				data = JSON.parse(message.utf8Data);
				if(data.M && data.M[0] && data.M[0].M === "updateExchangeState"){
					pair = data.M[0].A[0].MarketName;
					updateMarket(pair,data.M[0].A[0]);
					if(pair === this.Settings.Config.pair3){
						strategy[this.Settings.Config.pair3]["strat1"] = Number(localMarket[pair]["Sorted"][1][0]);
						strategy[this.Settings.Config.pair3]["strat2"] = Number(localMarket[pair]["Sorted"][0][localMarket[pair]["Sorted"][0].length - 1]);
						//If lowest Ask < highest bid return
						if(strategy[this.Settings.Config.pair3]["strat2"] < strategy[this.Settings.Config.pair3]["strat1"]){
							delete localMarket[pair]["Bids"][localMarket[pair]["Sorted"][1][0]];
							return;
						}
						Transactions[e1+'_amount1'] = localMarket[pair]["Bids"][localMarket[pair]["Sorted"][1][0]];
						Transactions[e1+'_amount2'] = localMarket[pair]["Asks"][localMarket[pair]["Sorted"][0][localMarket[pair]["Sorted"][0].length - 1]];
					}
					else if(pair === this.Settings.Config.pair2){
						strategy[this.Settings.Config.pair2]["strat1"] = Number(localMarket[pair]["Sorted"][1][0]);
						strategy[this.Settings.Config.pair2]["strat2"] = Number(localMarket[pair]["Sorted"][1][0]);
						if(strategy[this.Settings.Config.pair2]["strat1"] > Number(localMarket[pair]["Sorted"][0][localMarket[pair]["Sorted"][0].length - 1])){
							delete localMarket[pair]["Bids"][localMarket[pair]["Sorted"][1][0]];
							return;
						}
						Transactions[b3+'_amount1'] = localMarket[pair]["Bids"][localMarket[pair]["Sorted"][1][0]];
						Transactions[b3+'_amount2'] = localMarket[pair]["Bids"][localMarket[pair]["Sorted"][1][0]];
					}
					else{
						strategy[this.Settings.Config.pair1]["strat1"] = Number(localMarket[pair]["Sorted"][0][localMarket[pair]["Sorted"][0].length - 1]);
						strategy[this.Settings.Config.pair1]["strat2"] = Number(localMarket[pair]["Sorted"][1][0]);
						if(strategy[this.Settings.Config.pair1]["strat1"] < strategy[this.Settings.Config.pair1]["strat2"]){
							delete localMarket[pair]["Bids"][localMarket[pair]["Sorted"][1][0]];
							return;
						}
						Transactions[u2+'_amount1'] = localMarket[pair]["Asks"][localMarket[pair]["Sorted"][0][localMarket[pair]["Sorted"][0].length - 1]];
						Transactions[u2+'_amount2'] = localMarket[pair]["Bids"][localMarket[pair]["Sorted"][1][0]];
					}
					a =  strategy[this.Settings.Config.pair1].strat1,b = strategy[this.Settings.Config.pair2].strat1,c = strategy[this.Settings.Config.pair3].strat1;
					percentage = a * b/c * 100;
					if(!Number(percentage)){
						return;
					}
					if(this.viewBittrexBook){
						var rand = Math.floor(100 * Math.random(0,1));
						if(rand % 3 === 0){
							this.broadcastMessage({type:"bittrexBook",book:localMarket});
						}	
					}
					if(percentage < 100){
					trading_pairs = {"type":"percentage","exchange":"bittrex","percentage":percentage,"strategy":1}
					trading_pairs[pair1] = a,trading_pairs[pair2] = b,trading_pairs[pair3] = c;
					this.broadcastMessage(trading_pairs);
					Transactions[e1] = Number((this.balance[e1] * this.p1).toFixed(8));
					Transactions[u2] = 0.9975*Transactions[e1] * c;
					Transactions[b3] = 0.9975*Transactions[u2]/b;	
					Transactions[_e1] = Transactions[b3]/a * 0.9975;
					message = "Bittrex Bot:"+percentage.toFixed(3) +"%\n";
					message += Transactions[e1] + e1+ " => "+ Transactions[u2].toFixed(8) + pair3.split('-')[0] + " @"+c+"\n";
					message += Transactions[u2].toFixed(8)+ pair3.split('-')[0] + " => " +Transactions[b3].toFixed(8)+pair2.split('-')[1]  +" @"+b+"\n";
					message += Transactions[b3].toFixed(8)+pair2.split('-')[1] +" => "+Transactions[_e1].toFixed(8) + pair1.split('-')[1] +" @"+a;							
					Transactions[e1+'_status'] = this.balance[e1] >= Transactions[e1];
					Transactions[b3+'_status'] = this.balance[b3] > Transactions[b3];
					Transactions[u2+'_status'] = this.balance[u2] > Transactions[u2];
					liquidBook = Transactions[u2+'_amount1'] > Transactions[u2] && Transactions[b3+'_amount1'] > Transactions[b3] && Transactions[e1+'_amount1'] > Transactions[e1];
					sanity = percentage > this.lowerLimit && percentage < 99.25;
					myWallet = Transactions[e1+'_status'] && Transactions[b3+'_status'] && Transactions[u2+'_status'];
					if(this.saneTrades === true && sanity || this.saneTrades === false){
						if(this.liquidTrades && liquidBook || this.liquidTrades === false){
							if(myWallet){
								if(Transactions.btc < this.Settings.Bittrex.minimum){
										return this.log("Minimum btc order not met");
								}
								Transactions.percentage = percentage;
								Transactions.before = Transactions[e1];
								Transactions.after = Number(Transactions[_e1].toFixed(8));
								Transactions.profit = Number(Transactions[_e1].toFixed(8))/Transactions[e1];
								this.log("Starting Trades:",message,new Date());	
								try{
									for(var key in localMarket){
									for(var key2 in localMarket[key]){
										if(key2 !== "Sorted")delete localMarket[key][key2]
									}
								}	
								}catch(e){console.log(e)}	
								this.notify(message +"\r\n"+JSON.stringify(localMarket).replace(new RegExp('"', 'g'),""));
								this.bittrexInProcess = true;
								this.bittrexProcessTime = new Date().getTime();
								this.broadcastMessage({type:"bittrexStatus",value:this.bittrexInProcess,time:this.bittrexProcessTime,wsStatus:this.bittrexSocketStatus});
								return this.niceOrderChain([this.bittrexTrade,this.bittrexTrade,this.bittrexTrade,this.completedTrades],orders)
								.chain([["sell",pair3,Transactions[e1],c],["buy",pair2,Number(Transactions[b3].toFixed(8)),b],["buy",pair1,Transactions[_e1].toFixed(8),a]])
								.then(()=>{
										localMarket[this.Settings.Config.pair1] = {Bids:{},Asks:{}}
										localMarket[this.Settings.Config.pair2] = {Bids:{},Asks:{}}
										localMarket[this.Settings.Config.pair3] = {Bids:{},Asks:{}}
								})
								.catch((e)=>{
									this.log(e,new Date());
									this.notify("Error completing arbitrage:"+e);
									return setTimeout(()=>{return reset();},216000000);
								});
							}
							else{
								this.log("Current Bittrex balance not enough to place order:",new Date());
							}
						}
						else{
							this.log("Illiquid Trade:",new Date());
						}	
					}
					else{
						this.log("Insane Trade:",message);
					}
				}
					else{
						a =  strategy[this.Settings.Config.pair1].strat2,b = strategy[this.Settings.Config.pair2].strat2,c = strategy[this.Settings.Config.pair3].strat2;
						percentage = a * b/c * 100;
						trading_pairs = {"type":"percentage","exchange":"bittrex","percentage":percentage,"strategy":2}
						trading_pairs[pair1] = a,trading_pairs[pair2] = b,trading_pairs[pair3] = c;
						this.broadcastMessage(trading_pairs);
						Transactions.percentage = percentage;
						Transactions[b3] =  Number((this.balance[b3] * this.p2).toFixed(8));
						Transactions[u2] = 0.9975 * Transactions[b3] * b;
						Transactions[e1] = 0.9975*(Transactions[u2]/c);
						Transactions[_b3] = Number((0.9975 * Transactions[e1]*a).toFixed(8));
						message = "Bittrex Bot:" + percentage.toFixed(3)+"%\n";
						message = message + Transactions[b3] + b3 +" => "+Transactions[u2].toFixed(8)+" "+u2+" @" + b + '\n';
						message = message + Transactions[u2].toFixed(8) + u2+" => " + Transactions[e1].toFixed(8) + e1+" @"+c +'\n';
						message = message + Transactions[e1].toFixed(8) + e1+" => " + Transactions[_b3] +" "+b3+" @"+a;
						Transactions[e1+'_status'] = this.balance[e1] > Transactions[e1];
						Transactions[b3+'_status'] = this.balance[b3] > Transactions[b3];
						Transactions[u2+'_status'] = this.balance[u2] > Transactions[u2];
						liquidBook =  Transactions[u2+'_amount2'] > Transactions[u2] && Transactions[b3+'_amount2'] > Transactions[b3] && Transactions[e1+'_amount2'] > Transactions[e1];
						sanity = percentage > 100.7524 && percentage < this.upperLimit;
						myWallet = Transactions[e1+'_status'] && Transactions[b3+'_status'] && Transactions[u2+'_status'];
						if(this.saneTrades === true && sanity || this.saneTrades === false){
							if(this.liquidTrades && liquidBook || this.liquidTrades === false){
								if(myWallet){	
									if(Transactions.btc < this.Settings.Bittrex.minimum){
										//this.notify("Server error  ("+Transactions.btc+") BTC  is less than "+this.Settings.Bittrex.minimum+"\n"+message);
										//this.bittrexAccount().catch((e)=>{});
										return;
									}		
									Transactions.percentage = percentage;
									Transactions.before = Transactions[b3];
									Transactions.after = Transactions[_b3];
									Transactions.profit = Transactions[_b3]/Transactions[b3];	
									this.log("Starting Trades:",message,new Date());			
									try{
										for(var key in localMarket){
										for(var key2 in localMarket[key]){
											if(key2 !== "Sorted")delete localMarket[key][key2]
										}
									}	
									}catch(e){console.log(e)}		
									this.notify(message +"\r\n"+JSON.stringify(localMarket).replace(new RegExp('"', 'g'),""));
									this.bittrexInProcess = true;
									this.bittrexProcessTime = new Date().getTime();
									this.broadcastMessage({type:"bittrexStatus",value:this.bittrexInProcess,time:this.bittrexProcessTime,wsStatus:this.bittrexSocketStatus});
									return this.niceOrderChain([this.bittrexTrade,this.bittrexTrade,this.bittrexTrade,this.completedTrades],orders)
									.chain([["sell",pair2,Transactions[b3],b],["buy",pair3,Transactions[e1].toFixed(8),c],["sell",pair1,Transactions[e1].toFixed(8),a]])
									.then(()=>{
										localMarket[this.Settings.Config.pair1] = {Bids:{},Asks:{}}
										localMarket[this.Settings.Config.pair2] = {Bids:{},Asks:{}}
										localMarket[this.Settings.Config.pair3] = {Bids:{},Asks:{}}
									})
									.catch((e)=>{
										this.log(e,new Date());
										this.notify("Error completing arbitrage:"+e);
										return setTimeout(()=>{return reset();},216000000);
									});							
								}
								else{
									this.log("Current Bittrex balance not enough to place order");
								}
							}
							else{
								this.log("Illiquid Trade",new Date());
							}	
						}
						else{
							this.log("Insane Trade:",message);
						}									
					}
					
				}
			}
			catch(e){
				console.log("Error:",e)
			}
		},
		bindingError: (error)=> { 
			this.log("Bittrex Websocket bindingError: ", error); 
			this.updateBittrexSocketStatus(false);
		},
		connectionLost: (error)=> { 
			this.log("Bittrex Connection Lost: ", error); 
			this.updateBittrexSocketStatus(false);
			return this.bittrexStream(cookie,agent);
		},
		reconnecting: (retry)=> {
			this.log("Bittrex Websocket Retrying: ",retry,new Date());
			return false;
		}
	};
	client.start();
	return client;
}

CryptoBot.prototype.bittrexResetSwingOrder = function(){
	return this.saveDB("swing",{},{extra:{"w":1},method:"remove",query:{"swing":1},modifier:{}});
}

CryptoBot.prototype.bittrexSwing = function(){
	if(!this.vibrate){
		return;
	}
	var _order = (type,pair,amount,price) => {
		return this.bittrexTrade(type,pair,amount,price,{"swing":true})
			.then((order)=>{
				if(!order){
					this.log(e);
					return setTimeout(()=>{this.bittrexSwing()},this.swingRate);
				}
				this.swingTrade = false;
				this.bittrexAccount();
				this.saveDB("swing",{},{extra:{"w":1,"upsert":true},method:"update",query:{"swing":1},modifier:{"$set":{"swing":1,"order":order,"filled":false}}});
				return this.bittrexSwingOrder(order.uuid);
			}).catch((e)=>{
					this.log(e);
					return setTimeout(()=>{this.bittrexSwing()},this.swingRate);
				});
	}
	var _swing = (trade) =>{
		if(trade){
			if(trade.filled !== true){
				return this.bittrexSwingOrder(trade.order.OrderUuid);
			}
			var newTrade = trade.order.Type === "LIMIT_SELL" ? "buy" : "sell";
			this.bittrexDepthPure(this.Settings.Swing.pair).then((val)=>{
				if(newTrade === "buy"){
					var target =(1 - this.swingPercentage) * trade.order.Limit;
					this.log("Buying (Target/Price):",target+"/"+val.sell);
					this.broadcastMessage({"type":"swing","target":target,"price":val.sell,"trade":"bid"});
					if (val.sell < target){
						this.notify(this.Settings.Swing.pair+" Buying "+trade.order.Quantity+" @"+val.sell);
						return _order("buy",this.Settings.Swing.pair,trade.order.Quantity,val.sell);
					}
					else{
						return setTimeout(()=>{this.bittrexSwing()},this.swingRate);
					}
				}
				else{
					var target = (1 + this.swingPercentage) * trade.order.Limit;
					this.log("Selling (Target/Price):",target+"/"+val.buy);
					this.broadcastMessage({"type":"swing","target":target,"price":val.buy,"trade":"ask"});
					if (val.buy > target){
						this.notify(this.Settings.Swing.pair+" Selling "+trade.order.Quantity+" @"+val.buy);
						return _order("sell",this.Settings.Swing.pair,trade.order.Quantity,val.buy);
					}
					else{
						return setTimeout(()=>{this.bittrexSwing()},this.swingRate);
					}
				}
			}).catch((e)=>{
					this.log(e);
					return setTimeout(()=>{this.bittrexSwing()},this.swingRate);
				});								
		}
		else{	
			if(this.balance.btc < this.Settings.Swing.amount){
				return this.log("Account balance low:",this.balance);
			}
			return this.bittrexDepthPure(this.Settings.Swing.pair).then((val)=>{
				var amount = (this.Settings.Swing.amount/val.sell).toFixed(8)
				return _order("buy",this.Settings.Swing.pair,amount,val.sell)
			}).catch((e)=>{
					this.log(e);
					return setTimeout(()=>{this.bittrexSwing()},this.swingRate);
				});
		}	
	}
	if(!this.swingTrade){
		return this.retrieveDB("swing").then((trades)=>{
			this.swingTrade = trades[0];
			this.swingTrade.swing = this.Settings.Swing.swing;
			this.broadcastMessage({"type":"swingOrder","order":this.swingTrade});
			return _swing(this.swingTrade);
		}).catch((e)=>{
				this.log(e);
				return setTimeout(()=>{this.bittrexSwing()},this.swingRate);
			});
	}
	else{
		return _swing(this.swingTrade);
	}
			
}

CryptoBot.prototype.bittrexSwingOrder = function(uuid){
	return new Promise((resolve,reject) => {	
		this.bittrexAPI("account/getorder","&uuid="+uuid).then((order)=>{
			if(order){
				this.saveDB("swing",{},{extra:{"w":1},method:"update",query:{"swing":1},modifier:{"$set":{"swing":1,"order":order,"filled":!order.IsOpen}}});
				if(order.IsOpen !== true){
					this.notify("Order:"+uuid+" Filled");
					this.bittrexAccount();
					return setTimeout(()=>{this.bittrexSwing()},this.swingRate);
				}		
				return setTimeout(()=>{this.bittrexSwingOrder(uuid);},this.swingRate);		
			}
			else{
				this.log("Unable to find order:"+uuid);
				this.notify("Swing Error. Unable to find:"+uuid);
				return setTimeout(()=>{this.bittrexSwingOrder(uuid);},this.swingRate);
			}
		}).catch((e)=>{
				this.log(e);
				return setTimeout(()=>{this.bittrexSwingOrder(uuid);},this.swingRate);
			});	
	})
}	

CryptoBot.prototype.bittrexTrade = function(type,pair,quantity,rate,options){
	return new Promise((resolve,reject) => {	
		return this.bittrexAPI("market/"+type+"limit","&rate="+rate+"&market="+pair+"&quantity="+quantity).then((result)=>{
			this.log("Order:"+type+","+pair+" "+quantity+"@"+rate,result);
			if(result && result.uuid){
				this.bittrexAPI("account/getorder","&uuid="+result.uuid).then((order)=>{
					if(!options){
						this.saveDB("order",{"uuid":result.uuid,"order":order});
					}
				}).catch((e)=>{
						this.log("Error Placing Order:",e,new Date());
					});	
				return resolve(result);	
			}
			else{
				this.log("Error Placing Order:",new Date());
				this.notify("Trade Error:"+type+"/"+pair+"/"+quantity+"/"+rate);
				return reject(false);
			}
		}).catch((e)=>{
			this.log("Error Placing Order:",e,new Date());
			this.notify("Trade Error:"+type+"/"+pair+"/"+quantity+"/"+rate);
			return reject(e);
			
		});
	})
}

CryptoBot.prototype.broadcastMessage = function(data){
	try{
		if(!this.wss || !this.wss.clients){
			return;
		}
		return this.wss.clients.forEach((client)=> {
		    if (client.readyState === WebSocket.OPEN){
					try{
						var encrypted = typeof data === "string" ? crypto.AES.encrypt(data,this.Settings.Config.key).toString() : crypto.AES.encrypt(JSON.stringify(data),this.Settings.Config.key).toString();
						return client.send(encrypted);
					}
					catch(e){
						return this.log(e);
					}
			}
		});
	}
	catch(e){
		console.log(e);
	}
}	

CryptoBot.prototype.completedTrades = function(_orders) {
	try{
		var orders = {}
		if(!_orders){
			this.log("Error Completing Trades");
			this.bittrexInProcess = false;
			this.bittrexProcessTime = 0;
			this.broadcastMessage({type:"bittrexStatus",value:this.bittrexInProcess,time:this.bittrexProcessTime,wsStatus:this.bittrexSocketStatus});
		}
		for(var key in _orders){
			orders[_orders[key]['uuid']] = false;
		}
		return setTimeout(()=>{
			this.bittrexCompleteArbitrage(orders);
			this.saveDB("trade",{"Exchange":"Bittrex","Time":new Date().getTime(),Orders:orders,"Percent":this.Transactions.percentage,"Before":this.Transactions.before,"After":this.Transactions.after,"Profit":this.Transactions.profit});
		},10000);
	}
	catch(e){
		this.log("Error Completing Trades:",e);
		this.bittrexInProcess = false;
		this.bittrexProcessTime = 0;
		this.broadcastMessage({type:"bittrexStatus",value:this.bittrexInProcess,time:this.bittrexProcessTime,wsStatus:this.bittrexSocketStatus});
	}
}

CryptoBot.prototype.database = function(){
	var DB = {}
	if(this.Settings.MongoDB.connect){
		try{
			MongoClient.connect(this.Settings.MongoDB.db_string, (err, client)=>{
				var db = client.db(this.Settings.MongoDB.db_string.split("/")[this.Settings.MongoDB.db_string.split("/").length - 1]);
				if(err) { 
					return (this.log("Unable to connect to the database:",err)); 
				}
				else{
					db.createCollection('bittrexBalance',{strict:true},(err,collection)=>{ 
						if(!err){
							db.collection('bittrexBalance').createIndex( { "Time": 1 }, { unique: true } )
						}
						return DB.balance = db.collection('bittrexBalance');
					});	
					db.createCollection('bittrexTrade',{strict:true},(err,collection)=>{ 
						if(!err){
							db.collection('bittrexTrade').createIndex( { "Time": 1 }, { unique: true } )
						}
						return DB.trade = db.collection('bittrexTrade');	
					});	
					db.createCollection('bittrexOrder',{strict:true},(err,collection)=>{ 
						if(!err){
							db.collection('bittrexOrder').createIndex( { "uuid": 1 }, { unique: true } )
						}
						return DB.order = db.collection('bittrexOrder');	
					});	
					db.createCollection('bittrexSwing',{strict:true},(err,collection)=>{ 
						if(!err){
							db.collection('bittrexSwing').createIndex( { "swing": 1 }, { unique: true } )
						}
						return DB.swing = db.collection('bittrexSwing');	
					});													
				}
			});			
		}
		catch(e){
			this.log(e);
		}	
	}
	else{
		this.log("Database Not Found");
	}
	return DB;
}

CryptoBot.prototype.log = function(){
	if(this.logLevel === 0){
		return;
	}
	var args = [];
	for(var i=0;i < Object.keys(arguments).length;i++){
		if(typeof arguments[i.toString()] === "object"){
			args.push(JSON.stringify(arguments[i.toString()]));
		}
		else{
			args.push(arguments[i.toString()]);
		}
	}		
	if(this.logLevel === 1){
		console.log.apply(null,arguments);
		return true;
	}
	else if(this.logLevel === 2){
		this.broadcastMessage({"type":"log","log":args.join('')});
		return true;
	}
	else{
		console.log.apply(null,arguments);
		this.broadcastMessage({"type":"log","log":args.join('')});
		return true;
	}
}

CryptoBot.prototype.niceOrderChain = function(functions,obj){
	return{	
		chain:(array)=>{
			return new Promise((resolve,reject)=>{
				if(functions.length == 2){
					return functions[0].apply(this,array[0]).then((val)=>{
						obj[new Date().getTime()]= val;
						functions[1].call(this,obj);
						return resolve(obj);
					}).catch((e)=>{
						this.log(e);
						return reject(e);
						})
				}
				else{
					return functions[0].apply(this,array[0]).then((val)=>{
						functions.shift();
						array.shift();
						obj[new Date().getTime()] = val;
						return setTimeout(()=>{return resolve((this.niceOrderChain(functions,obj)).chain(array))},2000);
					}).catch((e)=>{
						this.log(e);
						return reject(e);
					})
					
				}
			});
		}
	}
}

CryptoBot.prototype.notify = function(message){
	if(this.Settings.Email.use){
		try{ 
			this.sendEmail(message);
		}
		catch(e){
			this.log(e);
		}
	}
	if(this.Settings.Slack.use){
		try{
			this.slackMessage(message);
		}
		catch(e){
			this.log(e);
		}
	}
	return;
}

CryptoBot.prototype.retrieveDB = function(type,options){
	return new Promise((resolve,reject) => {
		try{
			if(!this.DB || !this.DB[type]){
				this.DB = this.database();
			}
			if(!options){
				return this.DB[type].find({}).toArray((err, items)=>{
					if(err){
						this.log(err);
						return resolve(err);
					}
					else{
						return resolve(items);
					}
				});	
			}
			else{
				return this.DB[type].find(options.query).toArray((err, items)=>{
					if(err){
						this.log(err);
						return resolve(err);
					}
					else{
						return resolve(items);
					}
				});					
			}								
		}
		catch(e){
			this.log(e);
			return resolve(e);
		}
	})
}	

CryptoBot.prototype.saveDB = function(type,doc,options){
	return new Promise((resolve,reject) =>{		
		try{
			if(!this.Settings.MongoDB.connect){
				return this.log("MongoDB setting error")
			}
			if(!this.DB || !this.DB[type]){
				this.DB = this.database();
			}
			if(!options){
				return this.DB[type].insert(doc, {w:1},(err, result)=> {
					if(err){
						this.log("Error adding "+type+" to DB:",err);
						return resolve(false);
					}
					else{
						this.log(type+" added to DB:",new Date());
						return resolve(true);
					}
				});	
			}
			else{
				if(options.method ==="remove"){
					return this.DB[type][options.method](options.query,(err, result)=> {
						if(err){
							this.log("Error Removing "+type+" in DB:",err);
							return resolve(false);
						}
						else{
							this.log(type+" removed from DB");
							return resolve(true);
						}	
					})
				}
				return this.DB[type][options.method](options.query,options.modifier,options.extra,(err, result)=> {
					if(err){
						this.log("Error updating "+type+" in DB:",err);
						return resolve(false);
					}
					else{
						this.log(type+" updated in DB");
						return resolve(true);
					}
				});	
			}										
		}
		catch(e){
			this.log(e);
			return resolve(false);
		}
	})
}
CryptoBot.prototype.sendEmail = function(email_message){
	return new Promise((resolve,reject)=>{
		var email;
		var message;
		var server;		
		email  = require("emailjs");
		server = email.server.connect({
		   user: this.Settings.Email.usr, 
		   password: this.Settings.Email.pwd, 
		   host: this.Settings.Email.host_smtp, 
		   tls: true,
		   port: 587
		}); 
		message	= {
			   text:email_message, 
			   from: this.Settings.Email.usr, 
			   to: this.Settings.Email.addr,
			   subject:"C4D",
			   attachment:[{data:"<html>"+email_message+"</html>",alternative:true,inline:true}]			   
		};		
		return server.send(message,(err, message)=>{
			if(err){
				this.log("Error Sending Email:",err);
				return resolve(false);
			}
			return resolve(true)
		});
	})
}

CryptoBot.prototype.setupWebsocket = function(){
	return new Promise((resolve,reject) =>{			
		this.wss.on('connection',(ws)=>{
			resolve(this.log("Websocket connection created:",new Date()));
			ws.on('error',(e)=>{
				return this.log("WebSocket Error:",e,new Date());
			})
			ws.on('close',(e)=>{
				return this.log("WebSocket Closed:",e,new Date());
			})			
			ws.on('message',(message)=>{
				try{
					try{
						message = JSON.parse(crypto.AES.decrypt(message,this.Settings.Config.key).toString(crypto.enc.Utf8));												
					}
					catch(e){
						return this.log(e);
					}
					if(message.command === "binance_balance"){
						return this.binanceAccount();
					}					
					if(message.command === "binance_orders"){
						var check = [];
						this.Settings.Binance.pairs.forEach((i,v)=>{
							this.binanceOpenOrders(this.Settings.Binance.pairs[v].pair1.toUpperCase())
							.then(_orders=>{
								check = check.concat(_orders);
							})
							.then(()=>{
								this.binanceOpenOrders(this.Settings.Binance.pairs[v].pair2.toUpperCase())
								.then(_orders2=>{
									check = check.concat(_orders2);
								})
								.then(()=>{
									this.binanceOpenOrders(this.Settings.Binance.pairs[v].pair3.toUpperCase())
									.then(_orders3=>{
										check = check.concat(_orders3);
									})
									.then(()=>{					
										check.forEach((order)=>{
										return ws.send(crypto.AES.encrypt(JSON.stringify({"type":'order',"exchange":"Binance","otype":order.side,"timestamp_created":order.time,"rate":order.price,"status":order.status,"pair":order.symbol,"filled":order.origQty - order.executedQty,"amount":order.origQty,"order_id":order.clientOrderId}),this.Settings.Config.key).toString());
											});
									}).catch((e)=>{
										this.log(e);
									})
								})	
							})
							.catch((e)=>{
								this.log(e);
							})
						});
					}	
					if(message.command === "binanceB1Minimum"){
						this.binanceB1Min[message.pair] = Number(message.min);
						return this.log("Minimum Binance B1 Order:",message.pair,this.binanceB1Min[message.pair]);
					}	
					if(message.command === "binanceC1Minimum"){
						this.binanceC1Min[message.pair] = Number(message.min);
						return this.log("Minimum Binance "+message.pair+" Order:",this.binanceC1Min[message.pair]);
					}	
					if(message.command === "binanceMonitor"){
						this.binanceInProcess[message.pair] = message.bool;
						this.broadcastMessage({type:"binanceStatus",connections:this.binanceSocketConnections.length,value:this.binanceInProcess,time:this.binanceProcessTime,ustream:this.binanceUserStreamStatus});										
						return this.log("Binance Monitor Status:",this.binanceInProcess);
					}	
					if(message.command === "bittrexMonitor"){
						this.bittrexInProcess = message.bool;
						this.broadcastMessage({type:"bittrexStatus",value:this.bittrexInProcess,time:this.bittrexProcessTime,wsStatus:this.bittrexSocketStatus});		
						return this.log("Bittrex Monitor Status:",this.bittrexInProcess);								
					}											
					if(message.command === "bittrex_orders"){
						return this.bittrexGetOrders().then((orders)=>{
							orders.forEach(function(order){
								return ws.send(crypto.AES.encrypt(JSON.stringify({"type":'order',"exchange":"Bittrex","otype":order.OrderType,"timestamp_created":order.Opened,"rate":order.Limit,"status":order.Closed,"pair":order.Exchange,"filled":order.QuantityRemaining,"amount":order.Quantity,"order_id":order.OrderUuid}),this.Settings.Config.key).toString());
							});
						}).catch((e)=>{
							this.log(e);
						})
					}	
					if(message.command === "bittrex_db"){
						return this.retrieveDB(message.db).then((que)=>{
							return ws.send(crypto.AES.encrypt(JSON.stringify({"type":'db_'+message.db,"info":que}),this.Settings.Config.key).toString());														
						}).catch((e)=>{
							this.log(e);
							return ws.send(crypto.AES.encrypt(JSON.stringify({"type":'log',"log":e}),this.Settings.Config.key).toString());
						})								
					}						
					if(message.command === "connect"){
						ws.send(crypto.AES.encrypt(JSON.stringify({"type":'balance',"balance":this.balance,"p1":this.p1,"p2":this.p2,"polling":this.rate}),this.Settings.Config.key).toString());
						ws.send(crypto.AES.encrypt(JSON.stringify({"type":'config',"logLevel":this.logLevel,"swingPercentage":this.swingPercentage,"swingRate":this.swingRate,"sanity":this.saneTrades,"liquid":this.liquidTrades,"vibrate":this.vibrate,"upperLimit":this.upperLimit,"lowerLimit":this.lowerLimit,"status":this.bittrexInProcess,"time":this.bittrexProcessTime,"wsStatus":this.bittrexSocketStatus,"viewBook":this.viewBittrexBook}),this.Settings.Config.key).toString());
						ws.send(crypto.AES.encrypt(JSON.stringify({"type":'swingStatus',"amount":this.Settings.Swing.amount,"pair":this.Settings.Swing.pair,"order":this.swingTrade,"swing":this.Settings.Swing.swing,"on":this.Settings.Swing.swingTrade}),this.Settings.Config.key).toString());
						return ws.send(crypto.AES.encrypt(JSON.stringify({"type":'configBinance',
							"balance":this.binanceBalance,
							"status":this.binanceInProcess,
							"time":this.binanceProcessTime,
							"ustream":this.binanceUserStreamStatus,
							"minB1":this.binanceB1Min,
							"minXXX":this.binanceC1Min,
							"liquid":this.liquidTradesBinance,
							"connections":this.binanceSocketConnections.length,
							"pairs":this.Settings.Binance.pairs}),this.Settings.Config.key).toString());
					}			
					if(message.command === "logs"){
						this.logLevel = Number(message.logLevel);
						return this.log("LogLevel:",this.logLevel);
					}						
					if(message.command === "lowerLimit"){
						this.lowerLimit = message.limit;
						return this.log("Lower Limit:",this.lowerLimit);
					}															
					if(message.command === "poll"){
						if(Number(message.rate)){this.rate = message.rate * 1000;}
						return this.log("poll_rate:",this.rate/1000 +" seconds");
					}									
					if(message.command === "poll_rate"){
						return this.broadcastMessage({"type":"poll_rate","polling":this.rate});
					}											
					if(message.command === "bittrex_balance"){
						return this.bittrexAccount().catch(e=>this.log(e));
					}	
					if(message.command === "bittrex_book"){
						this.viewBittrexBook = message.bool;
						return this.log("View Bittrex Book:",this.viewBittrexBook);
					}
					if(message.command === "binance_control"){
						this.binanceKill = !message.bool;
						if(this.binanceKill === true){
							for(var i = 0; i < this.binanceSocketConnections.length;i++){
								this.binanceSocketConnections[i].close();
							}
							for(var key in this.binanceInProcess){
								this.binanceInProcess[key] = "killed";
							} 
							this.binanceSocketConnections = false;
							this.broadcastMessage({type:"binanceStatus",connections:0,value:this.binanceInProcess,"time":this.binanceProcessTime,ustream:this.binanceUserStreamStatus});										
							return this.log("Binance Socket Connections:",this.binanceSocketConnections);									
						}
						else if(this.binanceKill === false){
							for(var key in this.binanceInProcess){
								this.binanceInProcess[key] = false;
							} 
							this.binanceSocketConnections = [];
							this.binanceMonitor();
							if(!this.binanceUserStreamStatus){
								this.binanceListenUser();
							}
							return this.log("Starting Binance Socket Connections");
						}
					}
					if(message.command === "bittrex_control"){
						if(!message.bool && this.bittrexSocketConnection){
							this.bittrexSocketConnection.close();
							this.bittrexSocketConnection = undefined;
						}
						else if(message.bool && !this.bittrexSocketConnection){
							return this.bittrexPrepareStream().then((info)=>{
								this.bittrexStream(info[0],info[1])
							}).catch((e)=>{
								this.log("Error connecting to Bittrex Websocket");
							});
						}
					}						
					if(message.command === "liquidTrade"){
						this.liquidTrades = message.bool;
						return this.log("liquidTrades:",this.liquidTrades);
					}	
					if(message.command === "liquidTradeBinance"){
						this.liquidTradesBinance[message.pair] = message.bool;
						return this.log("liquidTradesBinance:",message.pair,this.liquidTradesBinance[message.pair]);
					}					
					if(message.command === "sanity"){
						this.saneTrades = message.bool;
						return this.log("saneTrades:",this.saneTrades);
					}
					if(message.command === "swingPercentage"){
						this.swingPercentage = message.percentage/100;
						return this.log("Swing Percentage:",this.swingPercentage);
					}												
					if(message.command === "swingPoll"){
						if(Number(message.rate)){this.swingRate = message.rate * 1000;}
						return this.log("poll_rate:",this.swingRate/1000 +" seconds");
					}	
					if(message.command === "swingReset"){
						this.bittrexResetSwingOrder();
						return this.log("swingTrading has been reset");
					}	
					if(message.command === "swingTrade"){
						this.vibrate = message.bool;
						if(message.bool === true && this.vibrate === false){
							this.bittrexSwing();
						}
						return this.log("Swing Trade:",this.vibrate);
					}		
					if(message.command === "update_percentage"){
						this.p1 = message.percentage1;
						return this.p2 = message.percentage2;
					}
					if(message.command === "upperLimit"){
						this.upperLimit = message.limit;
						return this.log("Upper Limit:",this.upperLimit);
					}																																																									
				}
				catch(e){
					this.log(e);
				}
			});				
		});	
	});				
}	

CryptoBot.prototype.slackMessage = function(slack_message){
	return new Promise((resolve,reject)=>{
		try{
			var parameters;
			var message;
			var req;
			message = slack_message + " @"+this.Settings.Slack.usr;
			parameters = {};
			parameters.channel = this.Settings.Slack.channel;
			parameters.username = "Server_Message";
			parameters.attachments = [{
				"pretext":new Date().toString().split('GM')[0],
				"text":message,
				"actions": [{
	                    "type": "button",
	                    "name": "webview",
	                    "text": "C4DC",
	                    "url": "http://arbitrage.0trust.us",
	                    "style": "primary",
	            }]
			}];
			req = https.request(
			    {
					host:"hooks.slack.com",
					path: this.Settings.Slack.hook.replace("https://hooks.slack.com",""),
					method:"Post",
				},
				(response)=>{
			        var body = "";
			        response.on("data",(d)=>{
						body += d;
					});
			        response.on("end",()=>{
						if(body === "ok"){
							return resolve(true)
						}
						else{return resolve(false)}
				    });
			        response.on('error',(e)=>{
						this.log("Slack Webhook Error:",e);
						return resolve(false);
					})
				}
		    );
		   req.write(JSON.stringify(parameters))
		   req.end();
		}
		catch(e){
			return this.log(e);
		}
	})
}		

CryptoBot.prototype.updateBittrexSocketStatus = function(bool){
	this.bittrexSocketStatus = bool;
	return this.broadcastMessage({type:"bittrexStatus",value:this.bittrexInProcess,time:this.bittrexProcessTime,wsStatus:this.bittrexSocketStatus});
}

module.exports = {bot:CryptoBot}
