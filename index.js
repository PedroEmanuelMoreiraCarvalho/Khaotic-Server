const app = require('express')();
const server = require('http').createServer(app);
const ws = require('ws')
const parser = require("socket.io-msgpack-parser");
const game = require('./game');
const port = process.env.PORT || 8000;
const io = require('socket.io')(server,{
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  wsEngine: ws.Server,
  parser
});

class Rooms {
    constructor(){
        this.rooms = []
        this.ports_in_use = []
    }

    getRoomById(id){
        let found_room = this.rooms.filter((room)=>{
            return room.id == id
        }).shift()
        return found_room
    }

    removeRoom(room_id){
        let room = this.getRoomById(room_id)
        let room_index = this.rooms.indexOf(room)
        this.rooms.splice(room_index, 1)
    }

    addRoom(room){
        this.rooms.push(room)
    }
}

class Room {
    constructor(id){
        this.id = id
        this.players_in_room = []
        this.queue_on = false
        this.game_started = false
    }

    getId(){
        return this.id
    }

    connect(player){
        this.players_in_room.push(player)
    }

    getPlayerById(player_id){
        let found_player = this.players_in_room.filter((player)=>{
            return player.player_id == player_id
        }).shift()
        return found_player
    }

    removePlayer(player_id){
        let player = this.getPlayerById(player_id)
        player.cancelQueue()
        let player_index = this.players_in_room.indexOf(player)
        this.players_in_room.splice(player_index, 1)
        this.players_in_room.length == 0 ? rooms.removeRoom(this.id) : null
    }

    emitToAllInRoom(eventName,args){
        this.players_in_room.forEach((player)=>{
            io.to(player.player_id).emit(eventName,args)
        })
    }

    emitToOneInRoom(player_id,eventName,args){
        io.to(player_id).emit(eventName,args)
    }

    updatePlayersForClients(){
        let players_list = this.players_in_room.map((player)=>{return player.player_nick})
        let players_data = {
            players_list
        }
        this.emitToAllInRoom('playersUpdateds',players_data)
    }

    gameStart(){
        this.game_started = true
        function makeid(length) {
            var result = '';
            var characters = '0123456789';
            var charactersLength = characters.length;
            for ( var i = 0; i < length; i++ ) {
                result += characters.charAt(Math.floor(Math.random() * charactersLength));
            }
            let new_port = (+result)+8001
            return new_port;
        }
            
        function createPort(){
            let id=makeid(4)
            let id_exist = rooms.ports_in_use.filter((use_id)=>{return use_id==id}).shift()
            if(id_exist){
                createId()
            }
            return id
        }
        
        let new_port = createPort()
        rooms.ports_in_use.push(new_port)

        game.addServer(this.players_in_room,new_port)
        this.emitToAllInRoom('gameStart',new_port)
    }

    startQueue(){
        this.queue_on = true
        let count = 3
        this.emitToAllInRoom('queueStart',count)
        let counter = setInterval(()=>{
            if(count > 0 && this.queue_on){
                count--
                if(count==0){
                    this.gameStart()
                }
                return
            }
            clearInterval(counter)
        },1000)
    }

    cancelQueue(){
        this.queue_on = false
        this.emitToAllInRoom('cancelQueue')
    }

    updateReadyPlayer(socket_id){
        if(this.game_started){
            this.emitToOneInRoom(socket_id,'gameAlreadyStarted')
            return
        }
        let total_players = this.players_in_room.length
        let ready_players = 0
        this.players_in_room.forEach((player,id)=>{
            player.ready ? ready_players++ : null
        })
        let ready_players_data = {
            ready_players: ready_players,
            total_players: total_players
        }
        this.emitToAllInRoom('readyPlayersUpdateds',ready_players_data)
        ready_players === total_players ? this.startQueue() : this.cancelQueue()
    }
}

class Player {
    constructor(id,nick,room_id){
        this.player_id = id
        this.player_nick = nick
        this.player_room_id = room_id
        this.ready = false
        this.character = "Sky"
    }

    getReady(){
        this.ready = true
    }

    cancelQueue(){
        this.ready = false
    }

    handleReady(){
        this.ready ? this.cancelQueue() : this.getReady()
    }

    setCharacter(character){
        this.character = character
    }
    
}

const EventListener = {
    createRoom(socket, args){
        function createRoomId(){
            function makeid(length) {
                var result = '';
                var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                var charactersLength = characters.length;
                for ( var i = 0; i < length; i++ ) {
                result += characters.charAt(Math.floor(Math.random() * charactersLength));
            }
            return result;
            }
            id_test = makeid(4)
            already_room = rooms.getRoomById(id_test)
            if(already_room){
                createRoomId()
            }
            return id_test
        }

        let newRoomId = createRoomId()
        let newRoom = new Room(newRoomId)
        rooms.addRoom(newRoom)
        let this_room_id = newRoom.getId()

        let newPLayer = new Player(socket.id, args.nick_name, this_room_id)
        
        newRoom.connect(newPLayer)
        newRoom.emitToOneInRoom(socket.id,'connected',this_room_id)
        newRoom.updatePlayersForClients()
        newRoom.updateReadyPlayer(socket.id)
        socket.room_id = this_room_id
    },

    enterRoom(socket, args){
        let enter_room = rooms.getRoomById(args.room_id)
        if(enter_room){
            let this_room_id = enter_room.getId()
            let newPLayer = new Player(socket.id, args.nick_name, this_room_id)
            enter_room.connect(newPLayer)
            enter_room.cancelQueue()
            enter_room.emitToOneInRoom(socket.id,'connected',this_room_id)
            enter_room.updatePlayersForClients()
            enter_room.updateReadyPlayer(socket.id)
            socket.room_id = newPLayer.player_room_id
        }
    },

    leaveRoom(socket){
        if(socket.room_id){
            let this_room = rooms.getRoomById(socket.room_id)
            if(!this_room)return
            this_room.removePlayer(socket.id)
            this_room.updatePlayersForClients()
            this_room.updateReadyPlayer(socket.id)
            this_room.cancelQueue()
            socket.room_id = undefined
        }
    },

    handleReady(socket){
        if(!socket.room_id) return 
        let this_room = rooms.getRoomById(socket.room_id)
        this_room.getPlayerById(socket.id).handleReady()
        this_room.updateReadyPlayer(socket.id)
    },

    setCharacter(socket, character){
        let this_room = rooms.getRoomById(socket.room_id)
        this_room.getPlayerById(socket.id).setCharacter(character)
    }
}

const rooms = new Rooms()

io.on('connection', (socket) => {
    socket.room_id = undefined
    
    socket.prependAny((eventName, args) => {
        const eventFunction = EventListener[eventName]
        if(!eventFunction)return
        eventFunction(socket,args)
    });

    socket.on('disconnect',()=>{
        const eventFunction = EventListener['leaveRoom']
        eventFunction(socket)
    })

});


server.listen(port);